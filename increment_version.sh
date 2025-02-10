#!/bin/bash

# Read the current version from version.txt
current_version=$(cat version.txt)

# Split the version into major, minor, and patch
IFS='.' read -r major minor patch <<< "$current_version"

# Increment the patch version
patch=$((patch + 1))

# Construct the new version
new_version="$major.$minor.$patch"

# Write the new version back to version.txt
echo "$new_version" > version.txt

echo "Version updated to $new_version"
