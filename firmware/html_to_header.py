#!/usr/bin/env python3
"""
Converts captive_portal.html to captive_portal.h
Run this after modifying the HTML file, or it runs automatically via PlatformIO pre-build.
"""

import os

def convert_html_to_header():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    html_path = os.path.join(script_dir, 'src', 'captive_portal.html')
    header_path = os.path.join(script_dir, 'src', 'captive_portal.h')

    with open(html_path, 'r', encoding='utf-8') as f:
        html_content = f.read()

    # Escape for C string
    escaped = html_content.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n"\n"')

    header_content = f'''#ifndef CAPTIVE_PORTAL_H
#define CAPTIVE_PORTAL_H

// Auto-generated from captive_portal.html - do not edit directly!
// Edit captive_portal.html and run: python html_to_header.py

static const char CAPTIVE_PORTAL_HTML[] =
"{escaped}";

#define CAPTIVE_PORTAL_HTML_LEN (sizeof(CAPTIVE_PORTAL_HTML) - 1)

#endif // CAPTIVE_PORTAL_H
'''

    with open(header_path, 'w', encoding='utf-8') as f:
        f.write(header_content)

    print(f"Generated {header_path} from {html_path}")

# When run directly
if __name__ == '__main__':
    convert_html_to_header()
else:
    # PlatformIO pre-build hook - runs when imported by PlatformIO
    try:
        from SCons.Script import Import
        Import("env")
        env = env  # noqa: F821 - injected by SCons
        # Run immediately when script is loaded (pre:script)
        convert_html_to_header()
    except (ImportError, Exception):
        # Not running under PlatformIO/SCons
        pass
