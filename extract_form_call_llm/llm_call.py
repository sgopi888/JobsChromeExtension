#!/usr/bin/env python3
import json
import sys
from pathlib import Path


DEBUG_DIR = Path(__file__).resolve().parent
ROOT_DIR = DEBUG_DIR.parent

FIELDS_PATH = DEBUG_DIR / "greenhouse_fields.json"
PROFILE_PATH = ROOT_DIR / "profile.txt"
RESUME_PATH = ROOT_DIR / "resume.txt"
ENV_PATH = ROOT_DIR / ".env"
OUTPUT_PATH = DEBUG_DIR / "llm_response.json"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_env(path: Path) -> dict:
    env_map = {}
    if not path.exists():
        return env_map
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_map[key.strip()] = value.strip().strip('"').strip("'")
    return env_map


def response_text(response) -> str:
    text = getattr(response, "output_text", None)
    if text:
        return text
    return str(response)


def extract_json(text: str):
    try:
        return json.loads(text)
    except Exception:
        pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(text[index:])
            if isinstance(obj, dict):
                return obj
        except Exception:
            continue
    raise ValueError("Could not parse a JSON object from model response.")


def build_prompts(fields_json_text: str, profile_text: str, resume_text: str):
    system_prompt = (
        "You are an autofill-planning assistant. "
        "Return ONLY valid JSON, no markdown and no explanations."
    )

    user_prompt = (
        "Task: produce field fill values for a job application.\n\n"
        "Rules:\n"
        "1) Use ONLY the provided context.\n"
        "2) Output JSON object with keys: url, field_count, filled_fields.\n"
        "3) filled_fields must be an array with one entry per input field from greenhouse_fields.json, preserving order.\n"
        "4) Each entry must include: id, question, field_type, value.\n"
        "5) If input has name, include name.\n"
        "6) For field_type='select', value must exactly match one option from that field's options.\n"
        "7) For field_type='checkbox_group', value must be an array of selected option labels.\n"
        "8) For field_type='url', provide full URL including https:// when available.\n"
        "9) If unknown, set value to empty string (or [] for checkbox_group).\n"
        "10) Do not invent facts.\n\n"
        "Context A: greenhouse_fields.json\n"
        f"{fields_json_text}\n\n"
        "Context B: profile.txt\n"
        f"{profile_text}\n\n"
        "Context C: resume.txt\n"
        f"{resume_text}\n"
    )
    return system_prompt, user_prompt


def generate_fill_json(
    fields: dict,
    profile_text: str,
    resume_text: str,
    env_map: dict | None = None,
    model_override: str | None = None,
) -> dict:
    if env_map is None:
        env_map = load_env(ENV_PATH)

    api_key = env_map.get("OPENAI_API_KEY", "").strip()
    model = (model_override or env_map.get("OPENAI_MODEL", "")).strip() or "gpt-5-nano"
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY missing in .env")

    try:
        from openai import OpenAI
    except Exception as error:
        raise RuntimeError(f"OpenAI SDK import failed: {error}") from error

    fields_json_text = json.dumps(fields, ensure_ascii=False)
    system_prompt, user_prompt = build_prompts(fields_json_text, profile_text, resume_text)

    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
            {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
        ],
    )
    text = response_text(response)
    parsed = extract_json(text)
    if not isinstance(parsed, dict):
        raise RuntimeError("Model output is not a JSON object.")
    return parsed


def main() -> int:
    missing = [str(path) for path in [FIELDS_PATH, PROFILE_PATH, RESUME_PATH, ENV_PATH] if not path.exists()]
    if missing:
        print("Missing required files:", file=sys.stderr)
        for item in missing:
            print(f"- {item}", file=sys.stderr)
        return 1

    env_map = load_env(ENV_PATH)
    fields_json_text = read_text(FIELDS_PATH)
    profile_text = read_text(PROFILE_PATH)
    resume_text = read_text(RESUME_PATH)
    fields = json.loads(fields_json_text)
    model = env_map.get("OPENAI_MODEL", "").strip() or "gpt-5-nano"

    try:
        parsed = generate_fill_json(fields, profile_text, resume_text, env_map=env_map)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    OUTPUT_PATH.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved: {OUTPUT_PATH}")
    print(f"Model: {model}")
    print(f"filled_fields: {len(parsed.get('filled_fields', []))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
