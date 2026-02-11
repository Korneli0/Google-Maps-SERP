# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-02-11

### Place ID & Automation Release

This release introduces precision business tracking using Google Place IDs and significantly improves the installation/update experience.

#### Added
- **Place ID Tracking:** Businesses are now tracked via their unique Google Place ID (`pid`) and CID (`cid`) instead of name matching. This eliminates hallucinations and ensures 100% accurate tracking even if business names change.
- **Improved Browser Isolation:** Implemented stricter "clean slate" logic for every scan point, including randomized User-Agents and canvas noise to prevent fingerprinting.
- **One-Click Installation:** Installers for macOS and Windows now automatically create the `.env` file with default configurations. No manual setup required.
- **One-Click Updates:** Added `update_mac.sh` and `update_windows.bat` to automate pulling latest code, updating dependencies, and rebuilding the app.

#### Changed
- **Scan Creation:** "My Business" mode now captures Place ID from Google Maps URLs or search results.
- **Business Cards:** Now display Place ID and CID in the expanded view for verification.

---

## [1.1.0] - 2026-02-10

### Comprehensive Audit & Accuracy Release

This release focuses on a deep audit of the application's core logic, significantly improving scanning accuracy, data reliability, and user experience.

#### Added
- **Isolated Browser Contexts:** Each grid point now runs in a fresh browser context to prevent Google's personalization from skewing results.
- **Improved Scraper Logic:** Added intelligent scrolling to ensure all 20 local pack results are captured reliably.
- **Enhanced Accuracy Headers:** Implemented `DNT` and `Sec-GPC` headers to further reduce search personalization.
- **Normalized Business Matching:** Replaced naive substring matching with a robust normalization algorithm (strips LLC/Inc suffixes, punctuation, etc.) for precise target business detection.
- **Real-time Dashboard Stats:** Dashboard now pulls actual data from the database (completed/active scans) instead of placeholder values.
- **Click-outside Dismiss:** Business lookup search dropdown now automatically dismisses when clicking elsewhere.

#### Changed
- **Scanner Zoom Level:** Increased to `15z` for better local-pack relevance at each grid point.
- **Competitor Intelligence Calculation:** Fixed a critical bug where review metrics were double-counted per-appearance. Statistics now correctly reflect unique businesses.
- **Strategic Analysis Refinement:** Threat score calculation denominator fixed to use total appearances instead of grid points.
- **UI Tab Fix:** Categories data now correctly renders under the "Categories" tab in the Competitor Intelligence dashboard.
- **openNow logic:** Refined to prevent false-positives for closed businesses (e.g., "Opens at 9 AM").

#### Fixed
- **Profile Metrics Typo:** Fixed `servicAreaBusinesses` typo throughout the codebase.
- **Strategic Analysis Styling:** Removed hacky string manipulation for threat level colors; implemented a type-safe hex color mapping.

#### Security
- **PATCH Endpoint Hardening:** Added field whitelisting to the scan update API to prevent arbitrary field modification.

---
