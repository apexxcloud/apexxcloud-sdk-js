class ApexxCloud {
  constructor(config = {}) {
    this.config = {
      baseUrl: config.baseUrl || "https://api.apexxcloud.com",
    };

    // Initialize API clients
    this.files = {
      upload: this.uploadFile.bind(this),
      uploadMultipart: this.uploadMultipart.bind(this),
    };
  }

  async uploadMultipart(
    file,
    getSignedUrl,
    {
      onProgress = () => {},
      onPartComplete = () => {},
      onComplete = () => {},
      onError = () => {},
      partSize = 5 * 1024 * 1024,
      signal,
      concurrency = 3,
    } = {}
  ) {
    let uploadId;
    let activeXHRs = new Set();

    const cleanup = () => {
      activeXHRs.forEach((xhr) => xhr.abort());
      activeXHRs.clear();
    };

    signal?.addEventListener("abort", () => {
      cleanup();
      onError({
        type: "abort",
        error: new Error("Upload aborted"),
        phase: "upload",
        timestamp: new Date(),
      });
    });

    try {
      // Start multipart upload
      const startUrl = await getSignedUrl("start-multipart", {
        key: file.name,
        totalParts: Math.ceil(file.size / partSize),
        mimeType: file.type,
      });

      const startUpload = () =>
        new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeXHRs.add(xhr);

          if (signal?.aborted) {
            onError({
              type: "abort",
              error: new Error("Upload aborted"),
              phase: "start",
              timestamp: new Date(),
            });
            reject(new Error("Upload aborted"));
            return;
          }

          xhr.open("POST", startUrl);
          xhr.setRequestHeader("Content-Type", "application/json");

          xhr.onload = () => {
            activeXHRs.delete(xhr);
            if (xhr.status >= 200 && xhr.status < 300) {
              const response = JSON.parse(xhr.responseText);
              resolve(JSON.parse(xhr.responseText));
            } else {
              const error = new Error(
                `Start upload failed with status ${xhr.status}`
              );
              onError({
                type: "error",
                error,
                phase: "start",
                status: xhr.status,
                timestamp: new Date(),
              });
              reject(error);
            }
          };

          xhr.onerror = () => {
            activeXHRs.delete(xhr);
            const error = new Error("Start upload failed");
            onError({
              type: "error",
              error,
              phase: "start",
              timestamp: new Date(),
            });
            reject(error);
          };

          xhr.send(
            JSON.stringify({
              filename: file.name,
              contentType: file.type,
              size: file.size,
            })
          );
        });

      const response = await startUpload();
      const uploadId = response.data.uploadId;
      // Calculate parts
      const totalParts = Math.ceil(file.size / partSize);
      const parts = [];
      let uploadedBytes = 0;

      // Upload parts with concurrency control
      const uploadPart = async (partNumber) => {
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);

        const partUrl = await getSignedUrl("uploadpart", {
          uploadId,
          partNumber,
          key: file.name,
          totalParts,
        });

        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeXHRs.add(xhr);

          if (signal?.aborted) {
            reject(new Error("Upload aborted"));
            return;
          }

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const partProgress = event.loaded / event.total;
              const partSize = end - start;
              const partLoaded = partSize * partProgress;
              const totalProgress =
                ((uploadedBytes + partLoaded) / file.size) * 100;

              onProgress({
                loaded: uploadedBytes + partLoaded,
                total: file.size,
                progress: totalProgress,
                part: {
                  number: partNumber,
                  progress: partProgress * 100,
                },
              });
            }
          };

          xhr.open("POST", partUrl);

          xhr.onload = () => {
            activeXHRs.delete(xhr);
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                const partData = response.data;

                uploadedBytes += chunk.size;

                const part = {
                  ETag: partData.ETag,
                  PartNumber: partData.partNumber,
                };

                onPartComplete(part);
                resolve(part);
              } catch (e) {
                const error = new Error(
                  "Invalid JSON response from upload part"
                );
                onError({
                  type: "error",
                  error,
                  phase: "upload",
                  partNumber,
                  status: xhr.status,
                  timestamp: new Date(),
                });
                reject(error);
              }
            } else {
              let errorMessage;
              try {
                const errorResponse = JSON.parse(xhr.responseText);
                errorMessage =
                  errorResponse.message ||
                  `Part upload failed with status ${xhr.status}`;
              } catch (e) {
                errorMessage =
                  xhr.responseText ||
                  `Part upload failed with status ${xhr.status}`;
              }

              const error = new Error(errorMessage);
              onError({
                type: "error",
                error,
                phase: "upload",
                partNumber,
                status: xhr.status,
                timestamp: new Date(),
              });
              reject(error);
            }
          };

          xhr.onerror = () => {
            activeXHRs.delete(xhr);
            reject(new Error("Part upload failed"));
          };
          const formData = new FormData();
          formData.append("file", chunk, file.name);
          xhr.send(formData);
        });
      };

      // Upload parts with concurrency control
      for (let i = 0; i < totalParts; i += concurrency) {
        const partNumbers = Array.from(
          { length: Math.min(concurrency, totalParts - i) },
          (_, index) => i + index + 1
        );

        const uploadedParts = await Promise.all(
          partNumbers.map((partNumber) => uploadPart(partNumber))
        );
        parts.push(...uploadedParts);
      }

      // Complete upload
      const completeUrl = await getSignedUrl("completemultipart", {
        uploadId,
        key: file.name,
      });

      const completeUpload = () =>
        new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeXHRs.add(xhr);

          xhr.open("POST", completeUrl);
          xhr.setRequestHeader("Content-Type", "application/json");

          // Add upload progress handler
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              onProgress({
                loaded: file.size, // At this point, all parts are uploaded
                total: file.size,
                progress: 100, // Complete
                phase: "complete",
                type: "progress",
              });
            }
          };

          xhr.onload = () => {
            activeXHRs.delete(xhr);
            if (xhr.status >= 200 && xhr.status < 300) {
              const response = JSON.parse(xhr.responseText);
              onProgress({
                loaded: file.size,
                total: file.size,
                progress: 100,
                phase: "complete",
                type: "progress",
              });
              onComplete({
                type: "complete",
                response,
                timestamp: new Date(),
                file: {
                  name: file.name,
                  size: file.size,
                  type: file.type,
                },
              });
              resolve(response);
            } else {
              reject(
                new Error(`Complete upload failed with status ${xhr.status}`)
              );
            }
          };

          xhr.onerror = () => {
            activeXHRs.delete(xhr);
            reject(new Error("Complete upload failed"));
          };
          xhr.send(
            JSON.stringify({
              parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
            })
          );
        });

      return await completeUpload();
    } catch (error) {
      cleanup();
      // If something goes wrong and we have an uploadId, try to cancel the upload
      if (uploadId) {
        try {
          const cancelUrl = await getSignedUrl("cancelmultipart", {
            uploadId,
            key: file.name,
          });

          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("DELETE", cancelUrl);
            xhr.onload = () => (xhr.status < 300 ? resolve() : reject());
            xhr.onerror = () => reject();
            xhr.send();
          });
        } catch (cancelError) {
          console.error("Failed to cancel multipart upload:", cancelError);
        }
      }

      onError({
        type: "error",
        error,
        phase: "upload",
        timestamp: new Date(),
      });
      throw error;
    }
  }

  async uploadFile(
    file,
    getSignedUrl,
    {
      onProgress = () => {},
      onComplete = () => {},
      onError = () => {},
      onStart = () => {},
      signal,
    } = {}
  ) {
    try {
      // Get signed URL for upload
      const signedUrl = await getSignedUrl("upload", {
        key: file.name,
        mimeType: file.type,
      });

      const xhr = new XMLHttpRequest();

      if (signal?.aborted) {
        onError({
          type: "abort",
          error: new Error("Upload aborted"),
          timestamp: new Date(),
        });
        throw new Error("Upload aborted");
      }

      signal?.addEventListener("abort", () => {
        xhr.abort();
        onError({
          type: "abort",
          error: new Error("Upload aborted"),
          timestamp: new Date(),
        });
      });

      // Return promise for upload completion
      return new Promise((resolve, reject) => {
        xhr.open("PUT", signedUrl);

        // Setup progress tracking
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = (event.loaded / event.total) * 100;
            onProgress({
              loaded: event.loaded,
              total: event.total,
              progress: percentComplete,
              type: "progress",
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
              type: file.type,
            },
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
                  type: file.type,
                },
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
                  type: file.type,
                },
              });
              resolve(xhr.responseText);
            }
          } else {
            const error = new Error(`Upload failed with status ${xhr.status}`);
            onError({
              type: "error",
              error,
              status: xhr.status,
              timestamp: new Date(),
            });
            reject(error);
          }
        };

        xhr.onerror = () => {
          const error = new Error("Upload failed");
          onError({
            type: "error",
            error,
            timestamp: new Date(),
          });
          reject(error);
        };

        xhr.onabort = () => {
          const error = new Error("Upload aborted");
          onError({
            type: "abort",
            error,
            timestamp: new Date(),
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
        timestamp: new Date(),
      });
      throw error;
    }
  }
}

export default ApexxCloud;
