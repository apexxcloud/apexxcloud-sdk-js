# ApexxCloud SDK for JavaScript

Official JavaScript SDK for ApexxCloud Storage Service.

## Installation 

```bash
npm install apexxcloud-sdk-js
```


## Quick Start

```javascript
import StorageSDK from 'apexxcloud-sdk-js';
const storage = new StorageSDK();
// Simple file upload
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];
const signedUrl = 'https://api.apexxcloud.com/...'; // Get from your backend
try {
const result = await storage.files.upload(signedUrl, file, {
onStart: (event) => {
console.log('Upload started:', event);
},
onProgress: (event) => {
console.log(Upload progress: ${event.progress}%);
},
onComplete: (event) => {
console.log('Upload completed:', event);
},
onError: (event) => {
console.error('Upload failed:', event);
}
});
} catch (error) {
console.error('Upload failed:', error);
}

```


## Features

- Simple file upload with progress tracking
- Multipart upload for large files
- Detailed progress and status callbacks
- TypeScript support
- Browser compatibility
- Minimal dependencies

## Documentation

For detailed documentation, visit [docs.apexxcloud.com](https://docs.apexxcloud.com)

## License

MIT
