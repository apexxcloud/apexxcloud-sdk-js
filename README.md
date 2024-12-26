# ApexxCloud SDK for JavaScript

Official JavaScript SDK for ApexxCloud Storage Service.

## Installation 

```bash
npm install @apexxcloud/sdk-js
```

## Quick Start

```javascript
import ApexxCloud from '@apexxcloud/sdk-js';

const storage = new ApexxCloud({
  baseUrl: 'https://api.apexxcloud.com' // optional
});

// Simple file upload using signed URL
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];

try {
  const result = await storage.files.upload(signedUrl, file, {
    onStart: (event) => {
      console.log('Upload started:', event);
    },
    onProgress: (event) => {
      console.log(`Upload progress: ${event.progress}%`);
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
- Detailed progress and status callbacks
- Browser compatibility
- Minimal dependencies

## API Reference

### File Operations

#### Upload a File
```javascript
await storage.files.upload(signedUrl, file, {
  onStart: (event) => {},    // Called when upload begins
  onProgress: (event) => {}, // Called during upload with progress info
  onComplete: (event) => {}, // Called when upload completes successfully
  onError: (event) => {}     // Called if upload fails
});
```

## Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| baseUrl | string | No | API base URL (defaults to https://api.apexxcloud.com) |

## License

MIT