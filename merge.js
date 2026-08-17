const fs = require('fs');

const dashContent = fs.readFileSync('views/user/dashboard.ejs', 'utf8');
const genLines = fs.readFileSync('views/user/GenerateEnhancePrompt.ejs', 'utf8').split('\n');

let dashTop = dashContent.split('<main class="main">')[0] + '<main class="main" style="padding:0; background:#F8FAFC;">\n';
let dashBottom = '</main>\n' + dashContent.split('</main>')[1];

// Inject tailwind before </head>
dashTop = dashTop.replace('</head>', '<script src="https://cdn.tailwindcss.com"></script>\n<script>tailwind.config={corePlugins:{preflight:false}}</script>\n</head>');

// Fix navigation active states
dashTop = dashTop.replace('class="nav-item active" href="#"', 'class="nav-item" href="/user/dashboard"');
dashTop = dashTop.replace('<a class="nav-item" href="/user/GenerateEnhancePrompt">', '<a class="nav-item active" href="/user/GenerateEnhancePrompt">');

// Extract tailwind app content from GenerateEnhancePrompt
const navStart = genLines.findIndex(l => l.includes('<nav class="glass sticky top-0'));
const scriptEnd = genLines.findIndex(l => l.includes('</body>'));

const contentToInject = genLines.slice(navStart, scriptEnd).join('\n');

const merged = dashTop + '<div class="text-slate-800 font-[Inter]">\n' + contentToInject + '\n</div>\n' + dashBottom;

fs.writeFileSync('views/user/GenerateEnhancePrompt.ejs', merged);
console.log("Merge script completely successfully.");
