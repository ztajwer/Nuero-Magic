const fs = require('fs');
const { execSync } = require('child_process');
const files = execSync('find . -name "*.ejs"').toString().trim().split('\n');
files.forEach(f => {
  if (f) {
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/logo\.jpeg/g, 'logo.png').replace(/logourdu\.jpeg/g, 'logourdu.png');
    fs.writeFileSync(f, c);
  }
});
console.log('Replaced all logos');
