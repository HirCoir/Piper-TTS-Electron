#!/usr/bin/env node

/**
 * Script to update package.json version from release tag
 * Usage: node update-version.js [version]
 * If no version is provided, it will use the GITHUB_REF environment variable
 */

const fs = require('fs');
const path = require('path');

function updateVersion(newVersion) {
  const packageJsonPath = path.join(__dirname, 'package.json');
  
  try {
    // Read current package.json
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const oldVersion = packageJson.version;
    
    // Clean version (remove 'v' prefix if present)
    const cleanVersion = newVersion.startsWith('v') ? newVersion.substring(1) : newVersion;
    
    // Update version
    packageJson.version = cleanVersion;
    
    // Write back to package.json with proper formatting
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    
    console.log(`✅ Version updated from ${oldVersion} to ${cleanVersion}`);
    return true;
  } catch (error) {
    console.error('❌ Error updating version:', error.message);
    return false;
  }
}

function main() {
  let version = process.argv[2];
  
  // If no version provided, try to get from environment (GitHub Actions)
  if (!version) {
    version = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF;
    if (version && version.includes('/')) {
      version = version.split('/').pop();
    }
  }
  
  if (!version) {
    console.error('❌ No version provided. Usage: node update-version.js [version]');
    console.error('   Or set GITHUB_REF_NAME environment variable');
    process.exit(1);
  }
  
  console.log(`🔄 Updating version to: ${version}`);
  
  if (updateVersion(version)) {
    console.log('✅ Version update completed successfully');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { updateVersion };
