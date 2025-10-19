#!/bin/bash

# Version Management for Clerky
# ==============================
#
# This project uses npm's built-in version management.
# The version is stored in package.json and automatically displayed on the web interface.
#
# To increment the version, use one of the following npm commands:
#
# Patch version (4.1.0 → 4.1.1):
#   npm version patch
#
# Minor version (4.1.0 → 4.2.0):
#   npm version minor
#
# Major version (4.1.0 → 5.0.0):
#   npm version major
#
# The version display on index.html will automatically update on the next page load.
#
# Note: By default, npm version creates a git tag. To skip that, add --no-git-tag-version:
#   npm version patch --no-git-tag-version
