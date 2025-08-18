const fs = require('fs');
const path = require('path');

// Function to recursively copy directory
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy public directory to dist
try {
  console.log('Copying public directory to dist...');
  copyDir('public', 'dist/public');
  console.log('Public directory copied successfully!');
} catch (error) {
  console.error('Error copying public directory:', error);
  process.exit(1);
}
