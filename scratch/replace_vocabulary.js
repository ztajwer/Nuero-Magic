const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '../views');

const filesToUpdate = [
    'index.ejs',
    'partials/sidebar.ejs',
    'partials/bottom_nav.ejs',
    'user/dashboard.ejs',
    'user/generate-prompt.ejs',
    'user/EnhanceCreation.ejs',
    'user/templates.ejs',
    'user/history.ejs',
    'user/folders.ejs'
];

const replacements = [
    // 1. Sidebar and index visible labels
    { from: /data-en="Generate Prompt"/g, to: 'data-en="Generate Magic"' },
    { from: /data-ur="پرامپٹ بنائیں"/g, to: 'data-ur="جادو بنائیں"' },
    { from: /data-en="Enhance Prompt"/g, to: 'data-en="Refine Magic"' },
    { from: /data-ur="پرامپٹ بہتر کریں"/g, to: 'data-ur="جادو سنواریں"' },
    
    // 2. Headings and other labels
    { from: /data-en="Enhance Magic"/g, to: 'data-en="Refine Magic"' },
    { from: /data-ur="جادوئی بہتری لائیں"/g, to: 'data-ur="جادو سنواریں"' },
    { from: /Enhance Magic/g, to: 'Refine Magic' },
    
    { from: /data-en="A new era of AI prompting"/g, to: 'data-en="A new era of AI instructions"' },
    { from: /data-ur="AI پرامپٹنگ کا نیا دور"/g, to: 'data-ur="AI ہدایات کا نیا دور"' },
    
    { from: /data-en="Start prompting like a pro."/g, to: 'data-en="Start creating instructions like a pro."' },
    { from: /data-ur="پرو کی طرح پرامپٹ کریں۔"/g, to: 'data-ur="پرو کی طرح ہدایات بنائیں۔"' },
    
    { from: /data-en="NeuroMagic helps you generate high-quality prompts faster—so you can get better results from any AI model with less effort."/g, to: 'data-en="NeuroMagic helps you generate high-quality instructions faster—so you can get better results from any AI model with less effort."' },
    { from: /data-ur="نیورو میجک آپ کو تیزی سے اعلیٰ معیار کے پرامپٹس بنانے میں مدد دیتا ہے تاکہ آپ کم محنت میں کسی بھی AI ماڈل سے بہتر نتائج حاصل کریں۔"/g, to: 'data-ur="نیورو میجک آپ کو تیزی سے اعلیٰ معیار کی ہدایات بنانے میں مدد دیتا ہے تاکہ آپ کم محنت میں کسی بھی AI ماڈل سے بہتر نتائج حاصل کریں۔"' },
    
    { from: /data-en="From quick ideas to detailed workflows—NeuroMagic gives you repeatable, high-quality prompting patterns that eliminate guesswork."/g, to: 'data-en="From quick ideas to detailed workflows—NeuroMagic gives you repeatable, high-quality instruction patterns that eliminate guesswork."' },
    { from: /data-ur="تیز آئیڈیاز سے لے کر مکمل ورک فلو تک—نیورو میجک آپ کو بار بار استعمال ہونے والے، اعلیٰ معیار کے پرامپٹنگ پیٹرنز دیتا ہے۔"/g, to: 'data-ur="تیز آئیڈیاز سے لے کر مکمل ورک فلو تک—نیورو میجک آپ کو بار بار استعمال ہونے والے، اعلیٰ معیار کے انسٹرکشن پیٹرنز دیتا ہے۔"' },
    
    { from: /data-en="Instant idea to prompt"/g, to: 'data-en="Instant idea to instruction"' },
    { from: /data-ur="آئیڈیا سے فوراً پرامپٹ"/g, to: 'data-ur="آئیڈیا سے فوراً ہدایت"' },
    
    { from: /data-en="Turn messy thoughts into structured, role-based prompts in seconds using our proprietary architect engine."/g, to: 'data-en="Turn messy thoughts into structured, role-based instructions in seconds using our proprietary architect engine."' },
    { from: /data-ur="بکھرے خیالات کو سیکنڈز میں منظم پرامپٹس میں بدلیں۔"/g, to: 'data-ur="بکھرے خیالات کو سیکنڈز میں منظم ہدایات میں بدلیں۔"' },
    
    { from: /data-en="Track what works. Monitor your token usage, daily limits, and most used prompt styles effortlessly."/g, to: 'data-en="Track what works. Monitor your token usage, daily limits, and most used instruction styles effortlessly."' },
    { from: /data-ur="کیا کام کرتا ہے دیکھیں اور وقت کے ساتھ بہتر کریں۔"/g, to: 'data-ur="کیا کام کرتا ہے دیکھیں اور وقت کے ساتھ بہتر بنائیں۔"' },
    
    { from: /data-en="Save your best creations to your personal favorites library. Build a repository of your perfect prompts."/g, to: 'data-en="Save your best creations to your personal favorites library. Build a repository of your perfect instructions."' },
    { from: /data-ur="پرامپٹس کاپی کریں، محفوظ کریں اور پروجیکٹس میں استعمال کریں۔"/g, to: 'data-ur="ہدایات کاپی کریں، محفوظ کریں اور پروجیکٹس میں استعمال کریں۔"' },
    
    { from: /data-en="Ready to transform your prompts?"/g, to: 'data-en="Ready to transform your instructions?"' },
    { from: /data-ur="اپنے پرامپٹس کو بہتر بنانے کے لیے تیار؟"/g, to: 'data-ur="اپنی ہدایات کو بہتر بنانے کے لیے تیار؟"' },
    
    { from: /data-en="Saved prompts for your current account."/g, to: 'data-en="Saved instructions for your current account."' },
    { from: /data-ur="آپ کے موجودہ اکاؤنٹ کے محفوظ شدہ پرامپٹس۔"/g, to: 'data-ur="آپ کے موجودہ اکاؤنٹ کی محفوظ شدہ ہدایات۔"' },
    
    { from: /data-en="Answer a few simple questions and I'll generate the perfect prompt for you."/g, to: 'data-en="Answer a few simple questions and I\'ll generate the perfect instruction for you."' },
    { from: /data-ur="چند آسان سوالات کے جواب دیں اور میں آپ کے لیے بہترین پرامپٹ تیار کروں گا۔"/g, to: 'data-ur="چند آسان سوالات کے جواب دیں اور میں آپ کے لیے بہترین ہدایت تیار کروں گا۔"' },
    
    { from: /data-en="Already have a prompt\? Go directly to Enhance"/g, to: 'data-en="Already have an instruction? Go directly to Refine"' },
    { from: /data-ur="اگر پرامپٹ پہلے سے ہے تو سیدھا Enhance پر جائیں"/g, to: 'data-ur="اگر ہدایت پہلے سے ہے تو سیدھا Refine پر جائیں"' },
    
    { from: /data-en="Generate My Prompt"/g, to: 'data-en="Generate My Magic"' },
    { from: /data-ur="میرا پرامپٹ تیار کریں"/g, to: 'data-ur="میرا جادو تیار کریں"' },
    
    { from: /data-en="Just a second, we're crafting the perfect prompt."/g, to: 'data-en="Just a second, we\'re crafting the perfect instruction."' },
    { from: /data-ur="بس ایک سیکنڈ، ہم بہترین پرامپٹ تیار کر رہے ہیں۔"/g, to: 'data-ur="بس ایک سیکنڈ، ہم بہترین ہدایت تیار کر رہے ہیں۔"' },
    
    { from: /data-en="Here’s what’s happening with your prompts today."/g, to: 'data-en="Here’s what’s happening with your magic creations today."' },
    { from: /data-ur="آج آپ کے پرامپٹس کی تازہ صورتحال یہ ہے۔"/g, to: 'data-ur="آج آپ کے جادوئی کاموں کی تازہ صورتحال یہ ہے۔"' },
    
    { from: /data-en="Prompts Generated"/g, to: 'data-en="Magic Generated"' },
    { from: /data-ur="بنے ہوئے پرامپٹس"/g, to: 'data-ur="بنے ہوئے جادو"' },
    
    { from: /data-en="Saved prompts"/g, to: 'data-en="Saved instructions"' },
    { from: /data-ur="محفوظ پرامپٹس"/g, to: 'data-ur="محفوظ ہدایات"' },
    
    { from: /data-en="Your latest prompt generations"/g, to: 'data-en="Your latest magic creations"' },
    { from: /data-ur="آپ کی تازہ تخلیقات"/g, to: 'data-ur="آپ کی تازہ جادوئی تخلیقات"' },
    
    { from: /data-en="No prompts yet"/g, to: 'data-en="No magic yet"' },
    { from: /data-ur="ابھی کوئی پرامپٹ نہیں"/g, to: 'data-ur="ابھی کوئی جادو نہیں"' },
    
    { from: /data-en="Create your first prompt to see it here."/g, to: 'data-en="Create your first magic instruction to see it here."' },
    { from: /data-ur="پہلا پرامپٹ بنائیں، یہ یہاں نظر آئے گا۔"/g, to: 'data-ur="پہلی ہدایت بنائیں، یہ یہاں نظر آئے گی۔"' },
    
    { from: /data-en="Recent Prompts"/g, to: 'data-en="Recent Magic"' },
    { from: /data-ur="حالیہ پرامپٹس"/g, to: 'data-ur="حالیہ جادو"' },
    
    // 3. EJS templates file text changes
    { from: />Generate Prompt</g, to: '>Generate Magic<' },
    { from: />Enhance Prompt</g, to: '>Refine Magic<' }
];

filesToUpdate.forEach(file => {
    const filePath = path.join(viewsDir, file);
    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️ File not found: ${filePath}`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    let replacedCount = 0;
    
    replacements.forEach(rep => {
        const matches = content.match(rep.from);
        if (matches) {
            replacedCount += matches.length;
            content = content.replace(rep.from, rep.to);
        }
    });

    if (replacedCount > 0) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✅ Updated ${file} (${replacedCount} replacements)`);
    } else {
        console.log(`ℹ️ No updates needed for ${file}`);
    }
});
