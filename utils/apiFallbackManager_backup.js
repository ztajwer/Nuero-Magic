// API Fallback Manager - Handles multiple API providers with automatic failover
const fetch = require('node-fetch');

class APIFallbackManager {
    constructor() {
        // Primary API providers (in order of preference)
        this.primaryProviders = [
            {
                name: 'Gemini',
                type: 'gemini',
                apiKey: process.env.GEMINI_API_KEY,
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
                model: 'gemini-1.5-flash-latest'
            },
            {
                name: 'OpenAI Proxy',
                type: 'openai',
                apiKey: process.env.OPENAI_API_KEY,
                endpoint: process.env.OPENAI_PROXY_URL || 'https://api.ai.cc/v1/chat/completions',
                model: 'gpt-4o-mini'
            },
            {
                name: 'OpenRouter',
                type: 'openrouter',
                apiKey: process.env.OPENROUTER_API_KEY,
                endpoint: 'https://api.openrouter.ai/v1/chat/completions', // Fixed malformed HTTPS URL
                model: 'anthropic/claude-3-haiku'
            }
        ];

        // Backup API providers (only used when all primary fail)
        this.backupProviders = [
            {
                name: 'Gemini Backup 1',
                type: 'gemini',
                apiKey: 'AIzaSyCvGdrfMxaLcnQ_g5GPrngJWAj3UpzJ1RU',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
                model: 'gemini-1.5-flash-latest'
            },
            {
                name: 'Gemini Backup 2',
                type: 'gemini',
                apiKey: 'AIzaSyDc44Ka1ChjUNEcEYW54yKbd_XtIYefyxk',
                endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent',
                model: 'gemini-1.5-flash-latest'
            }
        ];

        this.allProviders = [...this.primaryProviders, ...this.backupProviders];
    }

    // Format system instruction based on user preferences
    formatSystemInstruction(type, tone, level, lang) {
        const complexity = level === 'expert' ? 'Extremely detailed, multi-layered, and technical.' : 
                          level === 'detailed' ? 'Detailed and comprehensive.' : 
                          'Concise and effective.';
        
        const toneMap = {
            professional: 'professional, clear, and structured',
            creative: 'creative, imaginative, and engaging',
            casual: 'casual, friendly, and conversational',
            formal: 'formal, respectful, and articulate'
        };

        const typeMap = {
            writing: 'writing and content creation',
            image: 'image generation and visual descriptions',
            code: 'programming and technical development',
            business: 'business and professional communication',
            marketing: 'marketing and promotional content',
            social: 'social media and digital engagement'
        };

        const selectedTone = toneMap[tone] || 'professional and clear';
        const selectedType = typeMap[type] || 'general content creation';
        const language = lang === 'ur' ? 'Urdu' : 'English';

        return `You are an expert AI assistant specializing in ${selectedType}. 
Respond in ${selectedTone} tone. 
Content should be ${complexity}
Respond in ${language} language.
Provide high-quality, accurate, and helpful responses that meet the user's specific needs.`;
    }

    // Call Gemini API
    async callGemini(provider, prompt, systemInstruction) {
        const requestBody = {
            contents: [{
                parts: [{
                    text: `${systemInstruction}\n\nUser: ${prompt}`
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 8192,
            }
        };

        const url = `${provider.endpoint}?key=${provider.apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid Gemini API response structure');
        }

        return {
            text: data.candidates[0].content.parts[0].text,
            provider: provider.name,
            model: provider.model
        };
    }

    // Call OpenAI-compatible API
    async callOpenAI(provider, prompt, systemInstruction) {
        const requestBody = {
            model: provider.model,
            messages: [
                {
                    role: 'system',
                    content: systemInstruction
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 4096
        };

        const response = await fetch(provider.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (!data.choices || !data.choices[0]?.message?.content) {
            throw new Error('Invalid OpenAI API response structure');
        }

        return {
            text: data.choices[0].message.content,
            provider: provider.name,
            model: provider.model
        };
    }

    // Call specific provider based on type
    async callProvider(provider, prompt, systemInstruction) {
        switch (provider.type) {
            case 'gemini':
                return await this.callGemini(provider, prompt, systemInstruction);
            case 'openai':
            case 'openrouter':
                return await this.callOpenAI(provider, prompt, systemInstruction);
            default:
                throw new Error(`Unknown provider type: ${provider.type}`);
        }
    }

    // Main API call with fallback logic
    async generateContent(prompt, options = {}) {
        // Check if fetch is available
        if (!fetch) {
            throw new Error('Fetch function is not available. Please install node-fetch@2 or use Node 18+');
        }

        const {
            type = 'standard',
            tone = 'professional',
            level = 'standard',
            lang = 'en',
            userRole = 'General User'
        } = options;

        const systemInstruction = this.formatSystemInstruction(type, tone, level, lang);
        let lastError = null;
        let usedBackup = false;
        let attemptCount = 0;

        // Try primary providers first
        for (const provider of this.primaryProviders) {
            if (!provider.apiKey) {
                console.log(`Skipping ${provider.name} - no API key configured`);
                continue;
            }

            attemptCount++;
            try {
                console.log(`Attempting API call with ${provider.name} (Attempt ${attemptCount})`);
                const result = await this.callProvider(provider, prompt, systemInstruction);
                console.log(`✅ Success with ${provider.name}`);
                
                return {
                    ...result,
                    attemptCount,
                    usedBackup: false,
                    fallbackUsed: false
                };
            } catch (error) {
                lastError = error;
                console.log(`❌ Failed with ${provider.name}: ${error.message}`);
                
                // Continue to next provider
                continue;
            }
        }

        // If all primary providers failed, try backup providers
        console.log('🔄 All primary providers failed, trying backup providers...');
        
        for (const provider of this.backupProviders) {
            attemptCount++;
            try {
                console.log(`🔄 Attempting backup API call with ${provider.name} (Attempt ${attemptCount})`);
                const result = await this.callProvider(provider, prompt, systemInstruction);
                console.log(`✅ Backup success with ${provider.name}`);
                usedBackup = true;
                
                return {
                    ...result,
                    attemptCount,
                    usedBackup: true,
                    fallbackUsed: true
                };
            } catch (error) {
                lastError = error;
                console.log(`❌ Backup failed with ${provider.name}: ${error.message}`);
                continue;
            }
        }

        // If all providers failed
        throw new Error(`All API providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }

    // Get provider status
    getProviderStatus() {
        return {
            primary: this.primaryProviders.map(p => ({
                name: p.name,
                hasKey: !!p.apiKey,
                type: p.type
            })),
            backup: this.backupProviders.map(p => ({
                name: p.name,
                hasKey: !!p.apiKey,
                type: p.type
            }))
        };
    }
}

module.exports = new APIFallbackManager();
