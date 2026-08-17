const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '../views');

const filesToInject = [
    'user/dashboard.ejs',
    'user/generate-prompt.ejs',
    'user/EnhanceCreation.ejs',
    'user/templates.ejs',
    'user/history.ejs',
    'user/folders.ejs',
    'user/favorites.ejs',
    'user/plans.ejs',
    'user/settings.ejs',
    'user/Help.ejs',
    'user/Profile.ejs',
    'user/Onboarding.ejs'
];

filesToInject.forEach(file => {
    const filePath = path.join(viewsDir, file);
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ File not found: ${filePath}`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Check if stylesheet is already linked
    if (content.includes('/css/premium.css')) {
        console.log(`ℹ️ Already injected in ${file}`);
        return;
    }
    
    // Inject link tag right before </head>
    if (content.includes('</head>')) {
        content = content.replace('</head>', '    <link rel="stylesheet" href="/css/premium.css">\n</head>');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Injected stylesheet into ${file}`);
    } else {
        console.warn(`❌ No </head> tag found in ${file}`);
    }
});
