// Phase 2: Enhanced UI Components
// Handles resume upload, enhanced profile, and new workflow buttons

console.log('Phase 2: UI module loaded');

// ============================================
// RESUME UPLOAD SECTION
// ============================================

/**
 * Initialize resume upload functionality
 */
function initResumeUpload() {
    const resumePathInput = document.getElementById('resumePathInput');
    const browseResumeBtn = document.getElementById('browseResumeBtn');
    const uploadResumeBtn = document.getElementById('uploadResumeBtn');
    const autoUploadBtn = document.getElementById('autoUploadResumeBtn');
    const resumeStatus = document.getElementById('resumeStatus');
    
    if (!resumePathInput || !uploadResumeBtn) {
        console.warn('[Phase2-UI] Resume upload elements not found in DOM');
        return;
    }
    
    // Browse for file (opens file picker)
    if (browseResumeBtn) {
        browseResumeBtn.addEventListener('click', () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.pdf,.doc,.docx';
            
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    resumePathInput.value = file.name;
                    // Store the file object temporarily
                    window.tempResumeFile = file;
                }
            };
            
            fileInput.click();
        });
    }
    
    // Upload resume to profile (parse and store)
    uploadResumeBtn.addEventListener('click', async () => {
        try {
            const file = window.tempResumeFile;
            
            if (!file) {
                addSystemMessage('Please select a resume file first', 'error');
                return;
            }
            
            addSystemMessage('Uploading and parsing resume...');
            uploadResumeBtn.disabled = true;
            
            // Parse resume
            const formData = new FormData();
            formData.append('resume', file);
            
            const response = await fetch('http://localhost:3002/api/parse-resume', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`Server error: ${response.statusText}`);
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Parse failed');
            }
            
            // Convert file to base64 for storage
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Data = e.target.result;
                
                // Store in chrome.storage
                await chrome.storage.local.set({
                    resumeFile: {
                        name: file.name,
                        type: file.type,
                        data: base64Data,
                        text: result.resumeText,
                        metadata: result.metadata,
                        uploadedAt: new Date().toISOString()
                    }
                });
                
                // Update UI
                resumeStatus.textContent = `✓ ${file.name} uploaded (${result.metadata.pages} pages)`;
                resumeStatus.className = 'resume-status success';
                addSystemMessage(`✓ Resume uploaded and parsed successfully! (${result.resumeText.length} characters)`);
                
                // Enable auto-upload button
                if (autoUploadBtn) {
                    autoUploadBtn.disabled = false;
                }
                
                uploadResumeBtn.disabled = false;
                
                // Update context display
                updateContextDisplay('resumeContext', result.resumeText.substring(0, 500) + '...');
            };
            
            reader.readAsDataURL(file);
            
        } catch (error) {
            console.error('[Phase2-UI] Resume upload error:', error);
            addSystemMessage(`Resume upload failed: ${error.message}`, 'error');
            uploadResumeBtn.disabled = false;
        }
    });
    
    // Auto-upload resume to application page
    if (autoUploadBtn) {
        autoUploadBtn.addEventListener('click', async () => {
            try {
                addSystemMessage('Auto-uploading resume to application page...');
                autoUploadBtn.disabled = true;
                
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
                const response = await chrome.tabs.sendMessage(tab.id, {
                    action: 'autoUploadResume'
                });
                
                if (response && response.success) {
                    addSystemMessage(`✓ Resume uploaded! Cleared ${response.clearedFields} pre-filled fields.`);
                    addSystemMessage('Ready to scan page. Click "Scan Page" to continue.');
                    
                    // Enable scan button
                    document.getElementById('scanBtn').disabled = false;
                } else {
                    throw new Error(response?.error || 'Auto-upload failed');
                }
                
                autoUploadBtn.disabled = false;
                
            } catch (error) {
                console.error('[Phase2-UI] Auto-upload error:', error);
                addSystemMessage(`Auto-upload failed: ${error.message}`, 'error');
                autoUploadBtn.disabled = false;
            }
        });
    }
    
    // Load existing resume status on init
    loadResumeStatus();
}

/**
 * Load and display existing resume status
 */
async function loadResumeStatus() {
    try {
        const result = await chrome.storage.local.get('resumeFile');
        const resumeStatus = document.getElementById('resumeStatus');
        const autoUploadBtn = document.getElementById('autoUploadResumeBtn');
        
        if (result.resumeFile) {
            const resume = result.resumeFile;
            resumeStatus.textContent = `✓ ${resume.name} (uploaded ${new Date(resume.uploadedAt).toLocaleDateString()})`;
            resumeStatus.className = 'resume-status success';
            
            // Enable auto-upload button
            if (autoUploadBtn) {
                autoUploadBtn.disabled = false;
            }
            
            // Update context display
            if (resume.text) {
                updateContextDisplay('resumeContext', resume.text.substring(0, 500) + '...');
            }
        } else {
            resumeStatus.textContent = 'No resume uploaded';
            resumeStatus.className = 'resume-status';
        }
    } catch (error) {
        console.error('[Phase2-UI] Error loading resume status:', error);
    }
}

// ============================================
// ENHANCED PROFILE SECTION
// ============================================

/**
 * Initialize enhanced profile fields
 */
function initEnhancedProfile() {
    const saveProfileBtn = document.getElementById('saveProfileBtn');
    
    if (!saveProfileBtn) {
        console.warn('[Phase2-UI] Save profile button not found');
        return;
    }
    
    // Load existing profile
    loadEnhancedProfile();
    
    // Save enhanced profile
    saveProfileBtn.addEventListener('click', async () => {
        const profile = {
            // Basic info
            name: document.getElementById('nameInput')?.value || '',
            email: document.getElementById('emailInput')?.value || '',
            phone: document.getElementById('phoneInput')?.value || '',
            location: document.getElementById('locationInput')?.value || '',
            
            // Phase 2: Demographics
            gender: document.getElementById('genderInput')?.value || '',
            race: document.getElementById('raceInput')?.value || '',
            veteranStatus: document.getElementById('veteranStatusInput')?.value || '',
            disabilityStatus: document.getElementById('disabilityStatusInput')?.value || '',
            
            // Phase 2: Preferences
            nearestAirport: document.getElementById('airportInput')?.value || '',
            referralSource: document.getElementById('referralSourceInput')?.value || '',
            willingToTravel: document.getElementById('travelInput')?.checked || false
        };
        
        const qaLibrary = {
            sponsorship: document.getElementById('sponsorshipInput')?.value || '',
            startDate: document.getElementById('startDateInput')?.value || '',
            salary: document.getElementById('salaryInput')?.value || '',
            experience: document.getElementById('experienceInput')?.value || ''
        };
        
        await chrome.storage.local.set({ profile, qaLibrary });
        addSystemMessage('✓ Profile saved with enhanced fields!');
        updateContextDisplay('profileContext', JSON.stringify(profile, null, 2));
    });
}

/**
 * Load enhanced profile from storage
 */
async function loadEnhancedProfile() {
    try {
        const result = await chrome.storage.local.get(['profile', 'qaLibrary']);
        
        if (result.profile) {
            const profile = result.profile;
            
            // Basic info
            if (document.getElementById('nameInput')) document.getElementById('nameInput').value = profile.name || '';
            if (document.getElementById('emailInput')) document.getElementById('emailInput').value = profile.email || '';
            if (document.getElementById('phoneInput')) document.getElementById('phoneInput').value = profile.phone || '';
            if (document.getElementById('locationInput')) document.getElementById('locationInput').value = profile.location || '';
            
            // Demographics
            if (document.getElementById('genderInput')) document.getElementById('genderInput').value = profile.gender || '';
            if (document.getElementById('raceInput')) document.getElementById('raceInput').value = profile.race || '';
            if (document.getElementById('veteranStatusInput')) document.getElementById('veteranStatusInput').value = profile.veteranStatus || '';
            if (document.getElementById('disabilityStatusInput')) document.getElementById('disabilityStatusInput').value = profile.disabilityStatus || '';
            
            // Preferences
            if (document.getElementById('airportInput')) document.getElementById('airportInput').value = profile.nearestAirport || '';
            if (document.getElementById('referralSourceInput')) document.getElementById('referralSourceInput').value = profile.referralSource || '';
            if (document.getElementById('travelInput')) document.getElementById('travelInput').checked = profile.willingToTravel || false;
        }
        
        if (result.qaLibrary) {
            const qa = result.qaLibrary;
            if (document.getElementById('sponsorshipInput')) document.getElementById('sponsorshipInput').value = qa.sponsorship || '';
            if (document.getElementById('startDateInput')) document.getElementById('startDateInput').value = qa.startDate || '';
            if (document.getElementById('salaryInput')) document.getElementById('salaryInput').value = qa.salary || '';
            if (document.getElementById('experienceInput')) document.getElementById('experienceInput').value = qa.experience || '';
        }
    } catch (error) {
        console.error('[Phase2-UI] Error loading profile:', error);
    }
}

// ============================================
// INITIALIZATION
// ============================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initResumeUpload();
        initEnhancedProfile();
    });
} else {
    initResumeUpload();
    initEnhancedProfile();
}

// Export functions
window.Phase2UI = {
    initResumeUpload,
    initEnhancedProfile,
    loadResumeStatus,
    loadEnhancedProfile
};
