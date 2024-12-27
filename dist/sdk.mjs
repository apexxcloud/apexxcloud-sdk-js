class ApexxCloud {
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
  async uploadMultipart(file, getSignedUrl, {
    onProgress = () => {},
    onPartComplete = () => {},
    onComplete = () => {},
    onError = () => {},
    partSize = 5 * 1024 * 1024,
    signal,
    concurrency = 3
  } = {}) {
    try {
      // Start multipart upload
      const startUrl = await getSignedUrl("start-multipart", {
        key: file.name,
        totalParts: Math.ceil(file.size / partSize),
        mimeType: file.type
      });
      const startUpload = () => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        if (signal?.aborted) {
          onError({
            type: "abort",
            error: new Error("Upload aborted"),
            phase: "start",
            timestamp: new Date()
          });
          reject(new Error("Upload aborted"));
          return;
        }
        xhr.open("POST", startUrl);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const response = JSON.parse(xhr.responseText);
            resolve(JSON.parse(xhr.responseText));
          } else {
            const error = new Error(`Start upload failed with status ${xhr.status}`);
            onError({
              type: "error",
              error,
              phase: "start",
              status: xhr.status,
              timestamp: new Date()
            });
            reject(error);
          }
        };
        xhr.onerror = () => {
          const error = new Error("Start upload failed");
          onError({
            type: "error",
            error,
            phase: "start",
            timestamp: new Date()
          });
          reject(error);
        };
        xhr.send(JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size
        }));
      });
      const response = await startUpload();
      const uploadId = response.data.uploadId;
      // Calculate parts
      const totalParts = Math.ceil(file.size / partSize);
      const parts = [];
      let uploadedBytes = 0;

      // Upload parts with concurrency control
      const uploadPart = async partNumber => {
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);
        const partUrl = await getSignedUrl("uploadpart", {
          uploadId,
          partNumber,
          key: file.name,
          totalParts
        });
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          if (signal?.aborted) {
            reject(new Error("Upload aborted"));
            return;
          }
          xhr.upload.onprogress = event => {
            if (event.lengthComputable) {
              const partProgress = event.loaded / event.total;
              const partSize = end - start;
              const partLoaded = partSize * partProgress;
              const totalProgress = (uploadedBytes + partLoaded) / file.size * 100;
              onProgress({
                loaded: uploadedBytes + partLoaded,
                total: file.size,
                progress: totalProgress,
                part: {
                  number: partNumber,
                  progress: partProgress * 100
                }
              });
            }
          };
          xhr.open("POST", partUrl);
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                const partData = response.data;
                uploadedBytes += chunk.size;
                const part = {
                  ETag: partData.ETag,
                  PartNumber: partData.partNumber
                };
                onPartComplete(part);
                resolve(part);
              } catch (e) {
                const error = new Error("Invalid JSON response from upload part");
                onError({
                  type: "error",
                  error,
                  phase: "upload",
                  partNumber,
                  status: xhr.status,
                  timestamp: new Date()
                });
                reject(error);
              }
            } else {
              let errorMessage;
              try {
                const errorResponse = JSON.parse(xhr.responseText);
                errorMessage = errorResponse.message || `Part upload failed with status ${xhr.status}`;
              } catch (e) {
                errorMessage = xhr.responseText || `Part upload failed with status ${xhr.status}`;
              }
              const error = new Error(errorMessage);
              onError({
                type: "error",
                error,
                phase: "upload",
                partNumber,
                status: xhr.status,
                timestamp: new Date()
              });
              reject(error);
            }
          };
          xhr.onerror = () => reject(new Error("Part upload failed"));
          const formData = new FormData();
          formData.append("file", chunk, file.name);
          xhr.send(formData);
        });
      };

      // Upload parts with concurrency control
      for (let i = 0; i < totalParts; i += concurrency) {
        const partNumbers = Array.from({
          length: Math.min(concurrency, totalParts - i)
        }, (_, index) => i + index + 1);
        const uploadedParts = await Promise.all(partNumbers.map(partNumber => uploadPart(partNumber)));
        parts.push(...uploadedParts);
      }

      // Complete upload
      const completeUrl = await getSignedUrl("completemultipart", {
        uploadId,
        key: file.name
      });
      const completeUpload = () => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", completeUrl);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const response = JSON.parse(xhr.responseText);
            onComplete({
              type: "complete",
              response,
              timestamp: new Date(),
              file: {
                name: file.name,
                size: file.size,
                type: file.type
              }
            });
            resolve(response);
          } else {
            reject(new Error(`Complete upload failed with status ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Complete upload failed"));
        xhr.send(JSON.stringify({
          parts: parts.sort((a, b) => a.PartNumber - b.PartNumber)
        }));
      });
      return await completeUpload();
    } catch (error) {
      onError({
        type: "error",
        error,
        phase: "upload",
        timestamp: new Date()
      });
      throw error;
    }
  }
  async uploadFile(file, getSignedUrl, {
    onProgress = () => {},
    onComplete = () => {},
    onError = () => {},
    onStart = () => {},
    signal
  } = {}) {
    try {
      // Get signed URL for upload
      const signedUrl = await getSignedUrl("upload", {
        key: file.name,
        mimeType: file.type
      });
      const xhr = new XMLHttpRequest();

      // Setup abort signal handler
      if (signal?.aborted) {
        onError({
          type: "abort",
          error: new Error("Upload aborted"),
          timestamp: new Date()
        });
        throw new Error("Upload aborted");
      }
      signal?.addEventListener("abort", () => xhr.abort());

      // Return promise for upload completion
      return new Promise((resolve, reject) => {
        xhr.open("PUT", signedUrl);

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

        // Setup start handler
        xhr.upload.onloadstart = () => {
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
                timestamp: new Date(),
                file: {
                  name: file.name,
                  size: file.size,
                  type: file.type
                }
              });
              resolve(response);
            } catch (e) {
              onComplete({
                type: "complete",
                response: xhr.responseText,
                timestamp: new Date(),
                file: {
                  name: file.name,
                  size: file.size,
                  type: file.type
                }
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
        xhr.onerror = () => {
          const error = new Error("Upload failed");
          onError({
            type: "error",
            error,
            timestamp: new Date()
          });
          reject(error);
        };
        xhr.onabort = () => {
          const error = new Error("Upload aborted");
          onError({
            type: "abort",
            error,
            timestamp: new Date()
          });
          reject(error);
        };

        // Create FormData and send
        const formData = new FormData();
        formData.append("file", file);
        xhr.send(formData);
      });
    } catch (error) {
      onError({
        type: "error",
        error,
        timestamp: new Date()
      });
      throw error;
    }
  }
}

export { ApexxCloud as default };
//# sourceMappingURL=sdk.mjs.map
