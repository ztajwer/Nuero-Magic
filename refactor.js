const fs = require('fs');
const path = require('path');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.ejs')) {
            let content = fs.readFileSync(fullPath, 'utf8');

            // 1. Remove <?php ... ?> logic at the top that isn't just an echo (like session_start)
            // This is tricky using regex, we will instead just do some targeted replacements.
            
            // Remove pure PHP blocks like session_start(), require_once, etc.
            // Example: <?php session_start(); ... ?>
            content = content.replace(/<\?php[\s\S]*?(?:session_start|require_once\s+'auth_guard\.php')[\s\S]*?\?>/g, '');
            // For login.php:
            content = content.replace(/<\?php[\s\S]*?require_once\s+'db\.php'[\s\S]*?\?>/g, '');
            // For index.php: <?php $page_title = ... ?> -> just keep it or remove and pass from route
            content = content.replace(/<\?php\s+\$page_title[^>]*\?>/g, '');

            // 2. Replace <?= htmlspecialchars($var) ?> with EJS <%= var %>
            content = content.replace(/<\?=\s*htmlspecialchars\(\s*\$([a-zA-Z0-9_]+)[^)]*\)\s*\?>/g, '<%= $1 %>');
            
            // 3. Replace <?= $var ?> with <%= var %>
            content = content.replace(/<\?=\s*\$([a-zA-Z0-9_]+)\s*\?>/g, '<%= $1 %>');

            // 4. Replace <?php echo $var ?> with <%= var %>
            content = content.replace(/<\?php\s*echo\s*\$([a-zA-Z0-9_]+)\s*\?>/g, '<%= $1 %>');
            
            // 5. Replace links: something.php with /route/something
            content = content.replace(/href="([^"]+)\.php"/g, (match, p1) => {
                let route = p1;
                if (route.startsWith('../auth/')) route = route.replace('../auth/', '/auth/');
                else if (route.startsWith('../user/')) route = route.replace('../user/', '/user/');
                else if (route.startsWith('auth/')) route = '/' + route;
                else if (route.startsWith('user/')) route = '/' + route;
                else route = '/' + route;
                // remove any leading / if it's supposed to be relative, but express routing makes absolute easier
                return `href="${route}"`;
            });
            content = content.replace(/action="([^"]+)\.php"/g, (match, p1) => {
                let route = p1;
                if (route.startsWith('../auth/')) route = route.replace('../auth/', '/auth/');
                else if (route.startsWith('../user/')) route = route.replace('../user/', '/user/');
                else if (route.startsWith('auth/')) route = '/' + route;
                else if (route.startsWith('user/')) route = '/' + route;
                else route = '/' + route;
                return `action="${route}"`;
            });

            // 6. Handle specific PHP blocks: Error block in login.ejs/register.ejs
            // <?php if (!empty($errors)): ?> ... <?php foreach ($errors as $err): ?> <p>⚠ <?= htmlspecialchars($err) ?></p> <?php endforeach; ?> ... <?php endif; ?>
            content = content.replace(/<\?php if \(!empty\(\$errors\)\): \?>/g, '<% if (typeof errors !== "undefined" && errors.length > 0) { %>');
            content = content.replace(/<\?php foreach \(\$errors as \$err\): \?>/g, '<% errors.forEach(function(err) { %>');
            content = content.replace(/<\?php endforeach; \?>/g, '<% }); %>');
            content = content.replace(/<\?php endif; \?>/g, '<% } %>');
            
            content = content.replace(/<\?=\s*htmlspecialchars\(\$err\)\s*\?>/g, '<%= err %>');
            content = content.replace(/<\?=\s*htmlspecialchars\(\$_POST\['email'\] \?\? ''\)\s*\?>/g, '<%= typeof email !== "undefined" ? email : "" %>');
            content = content.replace(/<\?=\s*htmlspecialchars\(\$_POST\['name'\] \?\? ''\)\s*\?>/g, '<%= typeof name !== "undefined" ? name : "" %>');

            // 7. Remove any trailing ?> or dangling <?php from tops of files manually missed
            if(content.startsWith('<?php')) {
                const endPos = content.indexOf('?>');
                if(endPos > -1) {
                    content = content.substring(endPos + 2).trimStart();
                }
            }

            fs.writeFileSync(fullPath, content, 'utf8');
            console.log(`Refactored ${fullPath}`);
        }
    }
}

processDir(path.join(__dirname, 'views'));
