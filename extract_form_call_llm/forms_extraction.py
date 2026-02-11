#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

TARGET_URL = "https://job-boards.greenhouse.io/greenhouse/jobs/7535043?gh_jid=7535043"
OUTPUT_FILE = Path(__file__).with_name("greenhouse_fields.json")


def launch_browser(playwright):
    home = Path.home()
    executable_candidates = []

    executable_candidates.extend(
        sorted(
            home.glob(
                "Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            ),
            reverse=True,
        )
    )
    executable_candidates.extend(
        sorted(
            home.glob(
                "Library/Caches/ms-playwright/chromium-*/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
            ),
            reverse=True,
        )
    )
    executable_candidates.extend(
        sorted(
            home.glob(
                "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell"
            ),
            reverse=True,
        )
    )
    executable_candidates.extend(
        sorted(
            home.glob(
                "Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-x64/chrome-headless-shell"
            ),
            reverse=True,
        )
    )

    launch_error = None
    for executable in executable_candidates:
        try:
            return playwright.chromium.launch(headless=True, executable_path=str(executable))
        except Exception as error:
            launch_error = error

    try:
        return playwright.chromium.launch(headless=True)
    except Exception:
        if launch_error:
            raise launch_error
        raise


def _collect_visible_option_texts(page, selector):
    values = page.eval_on_selector_all(
        selector,
        """(nodes) => {
          const isVisible = (el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          const clean = (value) => (value || "").replace(/\\s+/g, " ").trim();
          const out = [];
          for (const node of nodes) {
            if (!isVisible(node)) continue;
            const text = clean(node.textContent);
            if (text && !out.includes(text)) out.push(text);
          }
          return out;
        }""",
    )
    return values or []


def hydrate_combobox_options(page, result):
    fields = result.get("fields", [])
    for field in fields:
        if field.get("field_type") != "select":
            continue
        element_id = field.get("id")
        if not element_id:
            continue

        locator = page.locator(f"[id='{element_id}'][role='combobox'], [id='{element_id}'].select__input")
        if locator.count() == 0:
            continue

        try:
            locator.first.click()
            page.wait_for_timeout(180)
            listbox_id = locator.first.get_attribute("aria-controls")
            option_selector = f"#{listbox_id} [role='option']" if listbox_id else ".select__menu [role='option']"
            if not page.locator(option_selector).count():
                locator.first.focus()
                page.keyboard.press("ArrowDown")
                page.wait_for_timeout(180)
                listbox_id = locator.first.get_attribute("aria-controls")
                option_selector = f"#{listbox_id} [role='option']" if listbox_id else ".select__menu [role='option']"
            options = _collect_visible_option_texts(page, option_selector)
            if options:
                field["options"] = options
            page.keyboard.press("Escape")
            page.wait_for_timeout(80)
        except Exception:
            # Continue extraction if a specific combobox cannot be opened in headless mode.
            continue


def _validate_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Invalid URL: {url}")
    return url


def extract_fields(url: str) -> dict:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        raise RuntimeError(
            "Playwright is not installed. Install with: pip install playwright && python -m playwright install chromium"
        )

    target_url = _validate_url(url)

    extractor_js = r"""
    () => {
      const form = document.querySelector(
        "form#application_form, form#application-form, form[action*='applications'], form"
      );
      if (!form) {
        return { url: window.location.href, field_count: 0, fields: [], error: "form_not_found" };
      }

      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        if (el.disabled) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const cleanText = (value) => (value || "").replace(/\s+/g, " ").trim();
      const URL_FIELD_HINTS = /(linkedin|github|portfolio|website|homepage|personal\s*site|profile\s*url|^url$)/i;

      const getLabel = (el) => {
        const ariaLabel = cleanText(el.getAttribute("aria-label"));
        if (ariaLabel) return ariaLabel;

        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const labels = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter(Boolean)
            .map((node) => cleanText(node.textContent))
            .filter(Boolean);
          if (labels.length) return labels.join(" ");
        }

        if (el.id) {
          const forLabel = form.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (forLabel) {
            const txt = cleanText(forLabel.textContent);
            if (txt) return txt;
          }
        }

        const wrappedLabel = el.closest("label");
        if (wrappedLabel) {
          const txt = cleanText(wrappedLabel.textContent);
          if (txt) return txt;
        }

        const fieldset = el.closest("fieldset");
        if (fieldset) {
          const legend = fieldset.querySelector("legend");
          if (legend) {
            const txt = cleanText(legend.textContent);
            if (txt) return txt;
          }
        }

        const nearestQuestion = el.closest("div");
        if (nearestQuestion) {
          const explicit = nearestQuestion.querySelector("label, legend, h3, h4, p");
          if (explicit) {
            const txt = cleanText(explicit.textContent);
            if (txt) return txt;
          }
        }

        return cleanText(el.getAttribute("placeholder")) || cleanText(el.name) || cleanText(el.id) || "";
      };

      const isUrlLikeField = (el, labelText) => {
        if ((el.getAttribute("type") || "").toLowerCase() === "url") return true;
        if ((el.getAttribute("inputmode") || "").toLowerCase() === "url") return true;
        const signature = [
          labelText,
          cleanText(el.getAttribute("placeholder")),
          cleanText(el.getAttribute("name")),
          cleanText(el.getAttribute("id")),
          cleanText(el.getAttribute("autocomplete")),
        ]
          .filter(Boolean)
          .join(" ");
        return URL_FIELD_HINTS.test(signature);
      };

      const nodes = Array.from(form.querySelectorAll("input, select, textarea"));
      const fields = [];
      const seenGroups = new Set();

      for (const el of nodes) {
        const tag = el.tagName.toLowerCase();
        const inputType = (el.getAttribute("type") || "text").toLowerCase();
        const role = (el.getAttribute("role") || "").toLowerCase();
        const isCombobox = role === "combobox" || el.classList.contains("select__input");

        if (tag === "input" && ["hidden", "button", "submit", "reset", "image"].includes(inputType)) {
          continue;
        }
        if (!isVisible(el)) continue;

        if ((inputType === "radio" || inputType === "checkbox") && el.name) {
          const groupKey = `${inputType}:${el.name}`;
          if (seenGroups.has(groupKey)) continue;
          seenGroups.add(groupKey);

          const groupNodes = Array.from(
            form.querySelectorAll(`input[type="${inputType}"][name="${CSS.escape(el.name)}"]`)
          ).filter(isVisible);

          const options = groupNodes
            .map((node) => {
              const optionLabel = getLabel(node);
              const optionValue = cleanText(node.value);
              return optionLabel || optionValue;
            })
            .filter(Boolean);

          let currentValue;
          if (inputType === "radio") {
            const checked = groupNodes.find((node) => node.checked);
            currentValue = checked ? (getLabel(checked) || cleanText(checked.value)) : null;
          } else {
            currentValue = groupNodes
              .filter((node) => node.checked)
              .map((node) => getLabel(node) || cleanText(node.value));
          }

          fields.push({
            question: getLabel(el),
            field_type: `${inputType}_group`,
            required: groupNodes.some((node) => node.required || node.getAttribute("aria-required") === "true"),
            options,
            current_value: currentValue,
            name: el.name || null,
            id: el.id || null,
          });
          continue;
        }

        let options = [];
        if (tag === "select") {
          options = Array.from(el.options || [])
            .map((opt) => cleanText(opt.textContent || opt.label || opt.value))
            .filter(Boolean);
        }
        const labelText = getLabel(el);
        const expectsUrl = isUrlLikeField(el, labelText);
        const resolvedFieldType =
          tag === "input" ? (isCombobox ? "select" : expectsUrl ? "url" : inputType) : tag;

        let currentValue;
        if (tag === "select") {
          if (el.multiple) {
            currentValue = Array.from(el.selectedOptions || []).map((opt) => cleanText(opt.textContent || opt.value));
          } else {
            currentValue = cleanText(el.value);
          }
        } else if (tag === "textarea") {
          currentValue = cleanText(el.value);
        } else if (inputType === "checkbox") {
          currentValue = Boolean(el.checked);
        } else {
          currentValue = cleanText(el.value);
        }

        fields.push({
          question: labelText,
          field_type: resolvedFieldType,
          required: Boolean(el.required || el.getAttribute("aria-required") === "true"),
          options,
          current_value: currentValue,
          name: el.name || null,
          id: el.id || null,
          role: role || null,
          is_combobox: Boolean(isCombobox),
          expects_url: Boolean(expectsUrl),
        });
      }

      return {
        url: window.location.href,
        field_count: fields.length,
        fields,
      };
    }
    """

    with sync_playwright() as playwright:
        browser = launch_browser(playwright)
        page = browser.new_page()
        page.goto(target_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.wait_for_selector("form", timeout=30000)

        result = page.evaluate(extractor_js)
        hydrate_combobox_options(page, result)
        browser.close()

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract form fields from a job application page.")
    parser.add_argument("url", nargs="?", default=TARGET_URL, help="Job application page URL.")
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="Path to save JSON output.")
    parser.add_argument("--no-save", action="store_true", help="Print only; do not save output.")
    args = parser.parse_args()

    try:
        result = extract_fields(args.url)
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    if not args.no_save:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"\nSaved: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
