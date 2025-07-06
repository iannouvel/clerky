# Server Endpoint for Duplicate File Checking

## Overview
The client-side duplicate checking functionality requires a new server endpoint at `/checkDuplicateFiles` to compare file hashes against existing files in the database.

## Endpoint Details

### POST /checkDuplicateFiles

**Purpose**: Check if files with the given hashes already exist in the database.

**Authentication**: Requires Firebase ID token in Authorization header.

**Request Body**:
```json
{
  "hashes": [
    {
      "hash": "sha256-hash-string",
      "filename": "example.pdf",
      "size": 1024000
    }
  ]
}
```

**Response**:
```json
{
  "success": true,
  "duplicates": ["hash1", "hash2"],
  "message": "Duplicate check completed"
}
```

## Implementation Requirements

1. **Database Schema**: 
   - Add a `fileHash` field to the guidelines collection in Firestore
   - Store SHA-256 hash when uploading new files

2. **Hash Comparison**:
   - Query Firestore for documents where `fileHash` matches any of the provided hashes
   - Return array of duplicate hashes found

3. **Error Handling**:
   - Handle authentication errors
   - Handle database connection errors
   - Return appropriate error messages

## Example Implementation (Node.js/Express)

```javascript
app.post('/checkDuplicateFiles', async (req, res) => {
    try {
        // Verify Firebase ID token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Missing or invalid authorization header' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        const { hashes } = req.body;
        if (!hashes || !Array.isArray(hashes)) {
            return res.status(400).json({ error: 'Invalid hashes array' });
        }

        // Extract hash strings
        const hashStrings = hashes.map(h => h.hash);
        
        // Query Firestore for existing files with these hashes
        const duplicates = [];
        const batch = db.batch();
        
        for (const hash of hashStrings) {
            const query = db.collection('guidelines').where('fileHash', '==', hash);
            const snapshot = await query.get();
            
            if (!snapshot.empty) {
                duplicates.push(hash);
            }
        }

        res.json({
            success: true,
            duplicates: duplicates,
            message: 'Duplicate check completed'
        });

    } catch (error) {
        console.error('Error checking duplicates:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
```

## Additional Considerations

1. **Performance**: For large numbers of files, consider batch queries or indexing
2. **Hash Storage**: Store hashes when uploading new files via the existing `/uploadGuideline` endpoint
3. **Migration**: Add hashes to existing files in the database
4. **Security**: Ensure proper authentication and input validation

## Testing

Test the endpoint with:
- Valid hash arrays
- Invalid hash formats
- Non-existent hashes
- Mixed existing/non-existing hashes
- Authentication failures 