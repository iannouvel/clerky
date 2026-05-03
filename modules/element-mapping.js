// Element-to-guideline mapping system
// Maps practice points to specific guideline sections

/**
 * Maps practice points to guideline sections
 * @param {Array} elements - Practice points
 * @param {Object} guideline - Guideline data
 * @returns {Promise<Array>} - Mapped elements with section references
 */
export async function mapElementsToGuideline(elements, guideline) {
    const mapped = [];

    for (const element of elements) {
        // Try to find guideline section reference in element
        const sectionRef = element.guidelineSection || null;

        mapped.push({
            ...element,
            guidelineId: guideline.id || guideline.guidelineId,
            guidelineTitle: guideline.title || guideline.humanFriendlyName,
            guidelineSection: sectionRef,
            mappingComplete: !!sectionRef
        });
    }

    // Store mapping in Firestore
    await storeElementMapping(guideline.id || guideline.guidelineId, mapped);

    return mapped;
}

/**
 * Stores element mapping in Firestore
 */
async function storeElementMapping(guidelineId, mappedElements) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const mappingData = {
        guidelineId,
        elements: mappedElements,
        totalElements: mappedElements.length,
        mappedElements: mappedElements.filter(e => e.mappingComplete).length,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('guidelineElements').doc(guidelineId).set(mappingData, { merge: true });

    console.log(`[ELEMENT-MAPPING] Stored mapping for guideline: ${guidelineId}`);
}

/**
 * Retrieves element mapping for a guideline
 */
export async function getElementMapping(guidelineId) {
    const admin = await import('firebase-admin');
    const db = admin.firestore();

    const doc = await db.collection('guidelineElements').doc(guidelineId).get();
    
    if (!doc.exists) {
        return null;
    }

    return doc.data();
}

