const fetchTest = async () => {
    try {
        const f = globalThis.fetch || require('node-fetch');
        console.log('Fetch type:', typeof f);
        const res = await f('https://api.github.com/zen', { headers: { 'User-Agent': 'node' } });
        console.log('Status:', res.status);
    } catch (e) {
        console.error('Error:', e.message);
    }
};
fetchTest();
