class ApexxCloud {
  constructor(config = {}) {
    this.config = {
      baseUrl: config.baseUrl || "https://api.apexxcloud.com",
      cdnUrl: config.cdnUrl || "https://cdn.apexxcloud.com",
      accessId: config.accessId,
    };

    // Initialize API clients
    this.files = {
      upload: this.uploadFile.bind(this),
      uploadMultipart: this.uploadMultipart.bind(this),
      transform: this.transformUrl.bind(this),
    };

    // Initialize transformation builder
    this.transformimage = new TransformBuilder(this.config);

    // Add video transformation builder
    this.transformvideo = new VideoTransformBuilder(this.config);

    this.transformdocument = new DocumentTransformBuilder(this.config);
  }

  // Add this method to generate transformed URLs
  transformUrl(path, transformations) {
    if (!this.config.accessId) {
      throw new Error("Access ID is required for transformations");
    }

    const transformString = Array.isArray(transformations)
      ? transformations.join("+")
      : transformations;

    return `${this.config.cdnUrl}/f/${this.config.accessId}/${transformString}/${path}`;
  }

  /**
   * Uploads a file using multipart upload strategy, suitable for large files.
   * @param {File} file - The file to upload
   * @param {Function} getSignedUrl - Callback function to get signed URLs for different upload phases
   * @param {Object} options - Upload configuration options
   * @param {Function} [options.onProgress] - Progress callback function
   * @param {Function} [options.onPartComplete] - Callback function called when each part is uploaded
   * @param {Function} [options.onComplete] - Callback function called when upload is complete
   * @param {Function} [options.onError] - Error callback function
   * @param {number} [options.partSize=5242880] - Size of each part in bytes (default: 5MB)
   * @param {AbortSignal} [options.signal] - AbortSignal to cancel the upload
   * @param {number} [options.concurrency=3] - Number of concurrent part uploads
   * @returns {Promise<Object>} Upload completion response
   * @throws {Error} If upload fails or is aborted
   */
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

  /**
   * Uploads a file using single request strategy, suitable for smaller files.
   * @param {File} file - The file to upload
   * @param {Function} getSignedUrl - Callback function to get signed URL for upload
   * @param {Object} options - Upload configuration options
   * @param {Function} [options.onProgress] - Progress callback function
   * @param {Function} [options.onComplete] - Callback function called when upload is complete
   * @param {Function} [options.onError] - Error callback function
   * @param {Function} [options.onStart] - Callback function called when upload starts
   * @param {AbortSignal} [options.signal] - AbortSignal to cancel the upload
   * @returns {Promise<Object>} Upload completion response
   * @throws {Error} If upload fails or is aborted
   */
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

// Add new TransformBuilder class
class TransformBuilder {
  constructor(config) {
    this.config = config;
    this.currentTransformation = [];
    this.transformations = [];
    this.isThumbail = false;
  }

  // Helper to add parameters to current transformation
  addParams(params) {
    this.currentTransformation.push(...params);
    return this;
  }

  // Helper to complete current transformation and start a new one
  completeTransformation() {
    if (this.currentTransformation.length > 0) {
      this.transformations.push(this.currentTransformation.join(","));
      this.currentTransformation = [];
    }
    return this;
  }

  // When you need to explicitly start a new transformation chain
  chain() {
    return this.completeTransformation();
  }

  // Individual parameter methods
  width(value) {
    const validWidth = Math.max(1, Math.min(5000, value));
    return this.addParams([`w_${validWidth}`]);
  }

  height(value) {
    const validHeight = Math.max(1, Math.min(5000, value));
    return this.addParams([`h_${validHeight}`]);
  }

  aspectRatio(value) {
    return this.addParams([`ar_${value}`]);
  }

  zoom(value) {
    return this.addParams([`z_${value}`]);
  }

  dpr(value) {
    const dpr = Math.max(1.0, Math.min(5.0, value));
    return this.addParams([`dpr_${dpr}`]);
  }

  crop(mode) {
    return this.addParams([`c_${mode}`]);
  }
  gravity(value) {
    return this.addParams([`g_${value}`]);
  }
  // Background color
  background(color) {
    if (color === "transparent") {
      return this.addParams(["b_transparent"]);
    }
    const cleanColor = color.replace("#", "");
    return this.addParams([`b_${cleanColor}`]);
  }

  // Border
  border(width, style, color) {
    const cleanColor = color.replace("#", "");
    return this.addParams([`bo_${width}_${style}_${cleanColor}`]);
  }

  // Corner radius
  radius(value) {
    if (Array.isArray(value)) {
      return this.addParams([`r_${value.join(":")}`]);
    }
    return this.addParams([`r_${value}`]);
  }

  // Rotation
  rotate(degrees) {
    const normalizedDegrees = ((degrees % 360) + 360) % 360;
    return this.addParams([`a_${normalizedDegrees}`]);
  }

  // Opacity
  opacity(percent) {
    const value = Math.max(0, Math.min(100, percent));
    return this.addParams([`o_${value}`]);
  }

  // Blur
  blur(radius) {
    const value = Math.max(1, Math.min(100, radius));
    return this.addParams([`blur_${value}`]);
  }

  // Grayscale
  grayscale() {
    return this.addParams(["e_grayscale"]);
  }

  // Text overlay
  text(text, options = {}) {
    const params = [`l_text:${text}`];
    if (options.font) params.push(`l_font_${options.font}`);
    if (options.size) params.push(`l_size_${options.size}`);
    if (options.color) params.push(`l_color_${options.color.replace("#", "")}`);
    if (options.gravity) params.push(`l_gravity_${options.gravity}`);
    if (options.x) params.push(`l_x_${options.x}`);
    if (options.y) params.push(`l_y_${options.y}`);
    if (options.opacity) {
      const opacity = Math.max(0, Math.min(100, options.opacity));
      params.push(`l_o_${opacity}`);
    }
    return this.addParams([params.join(":")]);
  }

  // Image overlay
  overlay(imagePath, options = {}) {
    const encodedPath = imagePath.replace(/\//g, "@@");
    const params = [`l_image:${encodedPath}`];
    if (options.gravity) params.push(`l_gravity_${options.gravity}`);
    if (options.x) params.push(`l_x_${options.x}`);
    if (options.y) params.push(`l_y_${options.y}`);
    if (options.scale) params.push(`l_scale_${options.scale}`);
    if (options.width) params.push(`l_width_${options.width}`);
    if (options.height) params.push(`l_height_${options.height}`);
    if (options.aspectRatio) params.push(`l_ar_${options.aspectRatio}`);
    if (options.opacity) {
      const opacity = Math.max(0, Math.min(100, options.opacity));
      params.push(`l_o_${opacity}`);
    }
    return this.addParams([params.join(":")]);
  }

  // Format conversion
  format(format) {
    const validFormats = ["auto", "avif", "webp", "jpeg", "png"];
    if (!validFormats.includes(format)) {
      throw new Error(
        `Invalid format: ${format}. Must be one of: ${validFormats.join(", ")}`
      );
    }
    return this.addParams([`f_${format}`]);
  }

  // Quality adjustment
  quality(value) {
    if (typeof value === "number") {
      const qualityValue = Math.max(1, Math.min(100, value));
      return this.addParams([`q_${qualityValue}`]);
    } else if (typeof value === "string" && value.startsWith("auto:")) {
      const validModes = ["best", "good", "eco", "low"];
      const mode = value.replace("auto:", "");
      if (!validModes.includes(mode)) {
        throw new Error(
          `Invalid auto quality mode: ${mode}. Must be one of: ${validModes.join(
            ", "
          )}`
        );
      }
      return this.addParams([`q_auto:${mode}`]);
    }
    throw new Error(
      "Quality value must be a number (1-100) or auto mode (auto:best, auto:good, auto:eco, auto:low)"
    );
  }

  // Build the final URL
  buildUrl(path) {
    if (!this.config.accessId) {
      throw new Error("Access ID is required for transformations");
    }
    const transformString = this.toString();
    return `${this.config.cdnUrl}/f/${this.config.accessId}/${transformString}/${path}`;
  }

  // Get transformation string
  toString() {
    this.completeTransformation(); // Complete any pending transformation

    if (this.transformations.length === 0) {
      return "";
    }

    const prefix = this.isThumbail ? "thumb-" : "tr-";
    return prefix + this.transformations.join("+");
  }
}

class VideoTransformBuilder {
  constructor(config) {
    this.config = config;
    this.currentTransformation = []; // Parameters for current transformation
    this.transformations = []; // Array of completed transformations
    this.isThumbail = false;
  }

  // Helper methods (same as TransformBuilder)
  addParams(params) {
    this.currentTransformation.push(...params);
    return this;
  }

  completeTransformation() {
    if (this.currentTransformation.length > 0) {
      this.transformations.push(this.currentTransformation.join(","));
      this.currentTransformation = [];
    }
    return this;
  }

  chain() {
    return this.completeTransformation();
  }

  // Individual parameter methods
  width(value) {
    const validWidth = Math.max(1, Math.min(5000, value));
    return this.addParams([`w_${validWidth}`]);
  }

  height(value) {
    const validHeight = Math.max(1, Math.min(5000, value));
    return this.addParams([`h_${validHeight}`]);
  }

  // Convenience methods for common aspect ratios
  aspectRatio(ratio) {
    return this.addParams([`ar_${ratio}`]);
  }

  crop(mode) {
    const validModes = ["crop", "fill", "fit", "scale", "limit", "pad"];
    if (!validModes.includes(mode)) {
      throw new Error(
        `Invalid crop mode: ${mode}. Must be one of: ${validModes.join(", ")}`
      );
    }
    return this.addParams([`c_${mode}`]);
  }

  // Gravity convenience methods
  gravity(position) {
    return this.addParams([`g_${position}`]);
  }

  // Background convenience methods
  background(color) {
    if (color === "blur") {
      return this.addParams(["b_blur"]);
    }
    const cleanColor = color.replace("#", "");
    return this.addParams([`b_${cleanColor}`]);
  }

  // Video effects
  blur(radius) {
    const value = Math.max(1, Math.min(100, radius));
    return this.addParams([`blur_${value}`]);
  }

  // Video overlays
  overlay(source, options = {}) {
    const encodedPath = source.replace(/\//g, "@@");
    const params = [`l_${options.type || "image"}`];
    params.push(`l_key_${encodedPath}`);
    if (options.gravity) params.push(`l_gravity_${options.gravity}`);
    if (options.x) params.push(`l_x_${options.x}`);
    if (options.y) params.push(`l_y_${options.y}`);
    if (options.scale) params.push(`l_scale_${options.scale}`);
    if (options.width) params.push(`l_width_${options.width}`);
    if (options.height) params.push(`l_height_${options.height}`);
    if (options.aspectRatio) params.push(`l_ar_${options.aspectRatio}`);
    if (options.opacity) {
      const opacity = Math.max(0, Math.min(100, options.opacity));
      params.push(`l_o_${opacity}`);
    }

    return this.addParams([params.join(":")]);
  }

  // Text overlay for videos
  text(text, options = {}) {
    const params = [`l_text:${text}`];
    if (options.font) params.push(`l_font_${options.font}`);
    if (options.size) params.push(`l_size_${options.size}`);
    if (options.color) params.push(`l_color_${options.color.replace("#", "")}`);
    if (options.gravity) params.push(`l_gravity_${options.gravity}`);
    if (options.x) params.push(`l_x_${options.x}`);
    if (options.y) params.push(`l_y_${options.y}`);
    if (options.opacity) {
      const opacity = Math.max(0, Math.min(100, options.opacity));
      params.push(`l_o_${opacity}`);
    }
    return this.addParams([params.join(":")]);
  }

  // Format conversion
  format(format) {
    const validFormats = ["mp4", "webm", "mov", "auto"];
    if (!validFormats.includes(format)) {
      throw new Error(
        `Invalid format: ${format}. Must be one of: ${validFormats.join(", ")}`
      );
    }
    return this.addParams([`f_${format}`]);
  }

  thumbnail(seekOffset = 5.0) {
    this.isThumbail = true;
    this.transform = new TransformBuilder(this.config);
    this.transform.addParams([`so_${seekOffset}`]);
    this.transform.isThumbail = true;
    return this; // Return this instead of transform
  }

  // Build URL (same as TransformBuilder)
  buildUrl(path) {
    if (!this.config.accessId) {
      throw new Error("Access ID is required for transformations");
    }
    const transformString = this.toString();
    return `${this.config.cdnUrl}/f/${this.config.accessId}/${transformString}/${path}`;
  }

  // Get transformation string (same as TransformBuilder)
  toString() {
    this.completeTransformation();
    if (this.transformations.length === 0) {
      return "";
    }
    return "tr-" + this.transformations.join("+");
  }
}

class DocumentTransformBuilder {
  constructor(config) {
    this.config = config;
    this.currentTransformation = [];
    this.transformations = [];
    this.isThumbail = false;
  }

  // Core helper methods
  addParams(params) {
    if (this.isThumbail) {
      return this.transform.addParams(params);
    }
    this.currentTransformation.push(...params);
    return this;
  }

  // Document format conversion
  format(value) {
    if (this.isThumbail) {
      return this.transform.format(value);
    }
    const validFormats = ["pdf", "docx", "xlsx", "pptx"];
    if (!validFormats.includes(value)) {
      throw new Error(
        `Invalid format: ${value}. Must be one of: ${validFormats.join(", ")}`
      );
    }
    return this.addParams([`f_${value}`]);
  }

  // Quality settings
  quality(value) {
    if (this.isThumbail) {
      return this.transform.quality(value);
    }
    if (typeof value === "string" && value.startsWith("auto:")) {
      const validModes = ["high", "standard", "low"];
      const mode = value.replace("auto:", "");
      if (!validModes.includes(mode)) {
        throw new Error(
          `Invalid auto quality mode: ${mode}. Must be one of: ${validModes.join(
            ", "
          )}`
        );
      }
      return this.addParams([`q_auto:${mode}`]);
    }
    throw new Error(
      "Document quality must be one of: auto:high, auto:standard, auto:low"
    );
  }

  // Compression mode
  compress(mode) {
    if (this.isThumbail) {
      throw new Error("Compression mode is not available for thumbnails");
    }
    const validModes = ["high", "medium", "low"];
    if (!validModes.includes(mode)) {
      throw new Error(
        `Invalid compression mode: ${mode}. Must be one of: ${validModes.join(
          ", "
        )}`
      );
    }
    return this.addParams([`c_${mode}`]);
  }

  // Page selection
  pages(range) {
    if (this.isThumbail) {
      throw new Error(
        "Page range is not available for thumbnails. Use thumbnail(page) instead."
      );
    }

    // Validate page range format
    const isValidRange = (range) => {
      // Single page: "1"
      if (/^\d+$/.test(range)) return true;
      // Page range: "1-3"
      if (/^\d+-\d+$/.test(range)) {
        const [start, end] = range.split("-").map(Number);
        return start <= end;
      }
      return false;
    };

    if (typeof range === "number") {
      return this.addParams([`p_${range}`]);
    }

    if (typeof range === "string") {
      const ranges = range.split(",");
      if (ranges.every(isValidRange)) {
        return this.addParams([`p_${range}`]);
      }
    }

    throw new Error(
      'Invalid page range. Use format: number, "1-3" or "1-3,5-7"'
    );
  }

  // Thumbnail entry point
  thumbnail(page = 1) {
    this.isThumbail = true;
    this.transform = new TransformBuilder(this.config);
    this.transform.addParams([`pg_${page}`]);
    this.transform.isThumbail = true;
    return this;
  }

  // Build methods
  chain() {
    if (this.isThumbail) {
      return this.transform.chain();
    }
    return this.completeTransformation();
  }

  buildUrl(path) {
    if (!this.config.accessId) {
      throw new Error("Access ID is required for transformations");
    }
    const transformString = this.toString();
    return `${this.config.cdnUrl}/f/${this.config.accessId}/${transformString}/${path}`;
  }

  toString() {
    if (this.isThumbail) {
      return this.transform.toString();
    }
    this.completeTransformation();
    if (this.transformations.length === 0) {
      return "";
    }
    return "tr-" + this.transformations.join("+");
  }
}

export default ApexxCloud;
