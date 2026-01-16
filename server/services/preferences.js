const fs = require('fs');
const path = require('path');
const { db, admin } = require('../config/firebase');
const { AI_PROVIDER_PREFERENCE } = require('../config/constants');
const { debugLog } = require('../config/logger');

const USER_PREFERENCE_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const userPrefsDir = path.join(__dirname, '../../user_prefs');

// Ensure user preferences directory exists
if (!fs.existsSync(userPrefsDir)) {
    try {
        fs.mkdirSync(userPrefsDir, { recursive: true });
    } catch (e) {
        console.error('Failed to create user_prefs directory:', e);
    }
}

// Caches
const userPreferencesCache = new Map();
const userHospitalTrustCache = new Map();
const userGuidelineScopeCache = new Map();
const userModelPreferencesCache = new Map();
const userChunkDistributionProvidersCache = new Map();
const userRAGPreferenceCache = new Map();

// ============================================================================
// AI PROVIDER & MODEL PREFERENCES
// ============================================================================

// Get user's preferred AI provider
async function getUserAIPreference(userId) {
    if (userPreferencesCache.has(userId)) {
        const cachedData = userPreferencesCache.get(userId);
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            return cachedData.preference;
        } else {
            userPreferencesCache.delete(userId);
        }
    }

    debugLog(`Attempting to get AI preference for user: ${userId}`);

    try {
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    if (data && data.aiProvider) {
                        userPreferencesCache.set(userId, {
                            preference: data.aiProvider,
                            timestamp: Date.now()
                        });
                        return data.aiProvider;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserAIPreference, falling back to file storage:', firestoreError);
            }
        }

        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                if (userData && userData.aiProvider) {
                    userPreferencesCache.set(userId, {
                        preference: userData.aiProvider,
                        timestamp: Date.now()
                    });
                    return userData.aiProvider;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }

        const defaultProvider = 'DeepSeek';
        userPreferencesCache.set(userId, {
            preference: defaultProvider,
            timestamp: Date.now()
        });
        return defaultProvider;
    } catch (error) {
        console.error('Critical error in getUserAIPreference:', error);
        return 'DeepSeek';
    }
}

// Update user's AI provider preference
async function updateUserAIPreference(userId, provider) {
    console.log(`Updating AI preference for user ${userId} to ${provider}`);
    userPreferencesCache.set(userId, { preference: provider, timestamp: Date.now() });

    try {
        if (db) {
            try {
                await db.collection('userPreferences').doc(userId).set({
                    aiProvider: provider,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                console.log(`Successfully updated AI preference in Firestore for user: ${userId}`);
                return true;
            } catch (firestoreError) {
                console.error('Firestore error in updateUserAIPreference, falling back to file storage:', firestoreError);
            }
        }

        try {
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            let existingData = {};
            if (fs.existsSync(userPrefsFilePath)) {
                existingData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
            }
            fs.writeFileSync(userPrefsFilePath, JSON.stringify({
                ...existingData,
                aiProvider: provider,
                updatedAt: new Date().toISOString()
            }));
            return true;
        } catch (fileError) {
            console.error('Failed to update user preference file:', fileError);
            return false;
        }
    } catch (error) {
        console.error('Error in updateUserAIPreference:', error);
        return false;
    }
}

// Get user's model preferences (ordered list)
async function getUserModelPreferences(userId) {
    if (userModelPreferencesCache.has(userId)) {
        const cachedData = userModelPreferencesCache.get(userId);
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            return cachedData.modelOrder;
        } else {
            userModelPreferencesCache.delete(userId);
        }
    }

    debugLog(`Attempting to get model preferences for user: ${userId}`);

    try {
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    if (data && data.modelPreferences && Array.isArray(data.modelPreferences)) {
                        userModelPreferencesCache.set(userId, {
                            modelOrder: data.modelPreferences,
                            timestamp: Date.now()
                        });
                        return data.modelPreferences;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserModelPreferences, falling back to file storage:', firestoreError);
            }
        }

        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                if (userData && userData.modelPreferences && Array.isArray(userData.modelPreferences)) {
                    userModelPreferencesCache.set(userId, {
                        modelOrder: userData.modelPreferences,
                        timestamp: Date.now()
                    });
                    return userData.modelPreferences;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }

        const defaultOrder = AI_PROVIDER_PREFERENCE.map(p => p.model);
        userModelPreferencesCache.set(userId, {
            modelOrder: defaultOrder,
            timestamp: Date.now()
        });
        return defaultOrder;
    } catch (error) {
        console.error('Critical error in getUserModelPreferences:', error);
        return AI_PROVIDER_PREFERENCE.map(p => p.model);
    }
}

// Update user's model preferences
async function updateUserModelPreferences(userId, modelOrder) {
    console.log(`Updating model preferences for user ${userId} to:`, modelOrder);
    userModelPreferencesCache.set(userId, { modelOrder: modelOrder, timestamp: Date.now() });

    try {
        if (db) {
            try {
                await db.collection('userPreferences').doc(userId).set({
                    modelPreferences: modelOrder,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                return true;
            } catch (firestoreError) {
                console.error('Firestore error in updateUserModelPreferences, falling back to file storage:', firestoreError);
            }
        }

        try {
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            let existingData = {};
            if (fs.existsSync(userPrefsFilePath)) {
                existingData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
            }
            existingData.modelPreferences = modelOrder;
            existingData.updatedAt = new Date().toISOString();
            fs.writeFileSync(userPrefsFilePath, JSON.stringify(existingData, null, 2));
            return true;
        } catch (fileError) {
            console.error('Failed to update user preference file:', fileError);
            return false;
        }
    } catch (error) {
        console.error('Error in updateUserModelPreferences:', error);
        return false;
    }
}

// Get provider name from model ID
function getProviderFromModel(modelId) {
    const provider = AI_PROVIDER_PREFERENCE.find(p => p.model === modelId);
    if (provider) return provider.name;

    if (modelId.includes('deepseek')) return 'DeepSeek';
    if (modelId.startsWith('grok-')) return 'Grok';
    if (modelId.includes('gpt') && !modelId.includes('gpt-oss')) return 'OpenAI';
    if (modelId.includes('claude')) return 'Anthropic';
    if (modelId.includes('gemini')) return 'Gemini';
    if (modelId.includes('llama') || modelId.includes('gpt-oss') || modelId.includes('qwen') || modelId.includes('kimi')) return 'Groq';
    if (modelId.includes('mistral')) return 'Mistral';

    return 'DeepSeek';
}

// Get user's 2nd preference LLM provider
async function getSecondPreferenceLLM(userId) {
    try {
        const modelOrder = await getUserModelPreferences(userId);
        if (modelOrder && modelOrder.length >= 2) {
            const modelId = modelOrder[1];
            return getProviderFromModel(modelId);
        }
        return AI_PROVIDER_PREFERENCE[1]?.name || 'OpenAI';
    } catch (error) {
        console.error('Error getting second preference LLM:', error);
        return AI_PROVIDER_PREFERENCE[1]?.name || 'OpenAI';
    }
}

// ============================================================================
// CHUNK DISTRIBUTION PREFERENCES
// ============================================================================

async function getUserChunkDistributionProviders(userId) {
    try {
        const cached = userChunkDistributionProvidersCache.get(userId);
        if (cached && (Date.now() - cached.timestamp) < (5 * 60 * 1000)) {
            return cached.providers;
        }

        const defaultProviders = AI_PROVIDER_PREFERENCE.map(p => p.name);

        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    if (data && Array.isArray(data.chunkDistributionProviders) && data.chunkDistributionProviders.length > 0) {
                        const providers = data.chunkDistributionProviders;
                        userChunkDistributionProvidersCache.set(userId, { providers, timestamp: Date.now() });
                        return providers;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserChunkDistributionProviders:', firestoreError);
            }
        }

        userChunkDistributionProvidersCache.set(userId, { providers: defaultProviders, timestamp: Date.now() });
        return defaultProviders;
    } catch (error) {
        console.error('Critical error in getUserChunkDistributionProviders:', error);
        return AI_PROVIDER_PREFERENCE.map(p => p.name);
    }
}

async function updateUserChunkDistributionProviders(userId, providers) {
    userChunkDistributionProvidersCache.set(userId, { providers, timestamp: Date.now() });
    try {
        if (db) {
            await db.collection('userPreferences').doc(userId).set({
                chunkDistributionProviders: providers,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        }
    } catch (error) {
        console.error('Error updating chunk distribution providers in Firestore:', error);
    }
    return false;
}

// ============================================================================
// HOSPITAL TRUST & GUIDELINE SCOPE
// ============================================================================

async function getUserHospitalTrust(userId) {
    if (userHospitalTrustCache.has(userId)) {
        const cachedData = userHospitalTrustCache.get(userId);
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            return cachedData.hospitalTrust;
        } else {
            userHospitalTrustCache.delete(userId);
        }
    }

    debugLog(`Attempting to get hospital trust preference for user: ${userId}`);

    try {
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    if (data && data.hospitalTrust) {
                        userHospitalTrustCache.set(userId, {
                            hospitalTrust: data.hospitalTrust,
                            timestamp: Date.now()
                        });
                        return data.hospitalTrust;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserHospitalTrust, falling back to file storage:', firestoreError);
            }
        }

        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                if (userData && userData.hospitalTrust) {
                    userHospitalTrustCache.set(userId, {
                        hospitalTrust: userData.hospitalTrust,
                        timestamp: Date.now()
                    });
                    return userData.hospitalTrust;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }

        return null;
    } catch (error) {
        console.error('Critical error in getUserHospitalTrust:', error);
        return null;
    }
}

async function updateUserHospitalTrust(userId, hospitalTrust) {
    console.log(`Updating hospital trust preference for user ${userId} to ${hospitalTrust}`);
    userHospitalTrustCache.set(userId, { hospitalTrust: hospitalTrust, timestamp: Date.now() });

    try {
        if (db) {
            try {
                await db.collection('userPreferences').doc(userId).set({
                    hospitalTrust: hospitalTrust,
                    region: 'England & Wales',
                    updatedAt: new Date().toISOString()
                }, { merge: true });
                return true;
            } catch (firestoreError) {
                console.error('Firestore error in updateUserHospitalTrust, falling back to file storage:', firestoreError);
            }
        }

        try {
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            let existingData = {};
            if (fs.existsSync(userPrefsFilePath)) {
                existingData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
            }
            fs.writeFileSync(userPrefsFilePath, JSON.stringify({
                ...existingData,
                hospitalTrust: hospitalTrust,
                region: 'England & Wales',
                updatedAt: new Date().toISOString()
            }));
            return true;
        } catch (fileError) {
            console.error('Failed to update user preference file:', fileError);
            return false;
        }
    } catch (error) {
        console.error('Error in updateUserHospitalTrust:', error);
        return false;
    }
}

async function getUserGuidelineScope(userId) {
    if (userGuidelineScopeCache.has(userId)) {
        const cachedData = userGuidelineScopeCache.get(userId);
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            return cachedData.guidelineScope;
        } else {
            userGuidelineScopeCache.delete(userId);
        }
    }

    try {
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    if (data && data.guidelineScope) {
                        userGuidelineScopeCache.set(userId, {
                            guidelineScope: data.guidelineScope,
                            timestamp: Date.now()
                        });
                        return data.guidelineScope;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserGuidelineScope, falling back to file storage:', firestoreError);
            }
        }

        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                if (userData && userData.guidelineScope) {
                    userGuidelineScopeCache.set(userId, {
                        guidelineScope: userData.guidelineScope,
                        timestamp: Date.now()
                    });
                    return userData.guidelineScope;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }
        return null;
    } catch (error) {
        console.error('Critical error in getUserGuidelineScope:', error);
        return null;
    }
}

async function updateUserGuidelineScope(userId, scopeSelection) {
    if (scopeSelection === null) {
        userGuidelineScopeCache.delete(userId);
    } else {
        userGuidelineScopeCache.set(userId, { guidelineScope: scopeSelection, timestamp: Date.now() });
    }

    try {
        if (db) {
            if (scopeSelection === null) {
                await db.collection('userPreferences').doc(userId).update({
                    guidelineScope: admin.firestore.FieldValue.delete(),
                    updatedAt: new Date().toISOString()
                });
            } else {
                await db.collection('userPreferences').doc(userId).set({
                    guidelineScope: scopeSelection,
                    updatedAt: new Date().toISOString()
                }, { merge: true });
            }
            return true;
        }

        try {
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            let existingData = {};
            if (fs.existsSync(userPrefsFilePath)) {
                existingData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
            }
            if (scopeSelection === null) {
                delete existingData.guidelineScope;
            } else {
                existingData.guidelineScope = scopeSelection;
            }
            existingData.updatedAt = new Date().toISOString();
            fs.writeFileSync(userPrefsFilePath, JSON.stringify(existingData));
            return true;
        } catch (fileError) {
            return false;
        }
    } catch (error) {
        return false;
    }
}

// ============================================================================
// RAG PREFERENCES
// ============================================================================

async function getUserRAGPreference(userId) {
    if (userRAGPreferenceCache.has(userId)) {
        const cachedData = userRAGPreferenceCache.get(userId);
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            return cachedData.preferences;
        } else {
            userRAGPreferenceCache.delete(userId);
        }
    }

    const defaultPreferences = {
        useRAGSearch: false,
        ragReranking: true,
        ragTopK: 20
    };

    try {
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    const preferences = {
                        useRAGSearch: data.useRAGSearch ?? defaultPreferences.useRAGSearch,
                        ragReranking: data.ragReranking ?? defaultPreferences.ragReranking,
                        ragTopK: data.ragTopK ?? defaultPreferences.ragTopK
                    };
                    userRAGPreferenceCache.set(userId, { preferences, timestamp: Date.now() });
                    return preferences;
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserRAGPreference:', firestoreError);
            }
        }

        userRAGPreferenceCache.set(userId, { preferences: defaultPreferences, timestamp: Date.now() });
        return defaultPreferences;
    } catch (error) {
        console.error('Critical error in getUserRAGPreference:', error);
        return defaultPreferences;
    }
}

async function updateUserRAGPreference(userId, preferences) {
    userRAGPreferenceCache.set(userId, { preferences, timestamp: Date.now() });

    try {
        if (db) {
            const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
            const existingData = userPrefsDoc.exists ? userPrefsDoc.data() : {};
            await db.collection('userPreferences').doc(userId).set({
                ...existingData,
                useRAGSearch: preferences.useRAGSearch,
                ragReranking: preferences.ragReranking,
                ragTopK: preferences.ragTopK,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error in updateUserRAGPreference:', error);
        return false;
    }
}

module.exports = {
    getUserAIPreference,
    updateUserAIPreference,
    getUserModelPreferences,
    updateUserModelPreferences,
    getProviderFromModel,
    getSecondPreferenceLLM,
    getUserChunkDistributionProviders,
    updateUserChunkDistributionProviders,
    getUserHospitalTrust,
    updateUserHospitalTrust,
    getUserGuidelineScope,
    updateUserGuidelineScope,
    getUserRAGPreference,
    updateUserRAGPreference
};
