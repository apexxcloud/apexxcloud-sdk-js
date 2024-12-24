(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.ApexxCloudSDK = factory());
})(this, (function () { 'use strict';

  class StorageSDK {
    constructor(config = {}) {
      this.config = {
        baseUrl: config.baseUrl || "https://api.apexxcloud.com"
      };

      // Initialize API clients
      this.files = {
        upload: this.uploadFile.bind(this),
        uploadMultipart: this.uploadMultipart.bind(this)
      };
    }
    async uploadFile(signedUrl, file, {
      onProgress = () => {},
      onComplete = () => {},
      onError = () => {},
      onStart = () => {}
    } = {}) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const xhr = new XMLHttpRequest();

        // Setup progress tracking
        xhr.upload.onprogress = event => {
          if (event.lengthComputable) {
            const percentComplete = event.loaded / event.total * 100;
            onProgress({
              loaded: event.loaded,
              total: event.total,
              progress: percentComplete,
              type: "progress"
            });
          }
        };

        // Return promise for upload completion
        return new Promise((resolve, reject) => {
          xhr.open("POST", signedUrl, true);

          // Setup start handler
          xhr.upload.onloadstart = event => {
            onStart({
              type: "start",
              timestamp: new Date(),
              file: {
                name: file.name,
                size: file.size,
                type: file.type
              }
            });
          };

          // Setup completion handler
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                onComplete({
                  type: "complete",
                  response,
                  timestamp: new Date()
                });
                resolve(response);
              } catch (e) {
                onComplete({
                  type: "complete",
                  response: xhr.responseText,
                  timestamp: new Date()
                });
                resolve(xhr.responseText);
              }
            } else {
              const error = new Error(`Upload failed with status ${xhr.status}`);
              onError({
                type: "error",
                error,
                status: xhr.status,
                timestamp: new Date()
              });
              reject(error);
            }
          };

          // Setup error handler
          xhr.onerror = event => {
            const error = new Error("Upload failed");
            onError({
              type: "error",
              error,
              originalEvent: event,
              timestamp: new Date()
            });
            reject(error);
          };

          // Setup abort handler
          xhr.onabort = event => {
            const error = new Error("Upload aborted");
            onError({
              type: "abort",
              error,
              originalEvent: event,
              timestamp: new Date()
            });
            reject(error);
          };
          xhr.send(formData);
        });
      } catch (error) {
        onError({
          type: "error",
          error,
          timestamp: new Date()
        });
        throw new Error(`Upload failed: ${error.message}`);
      }
    }
  }

  return StorageSDK;

}));
//# sourceMappingURL=sdk.js.map
