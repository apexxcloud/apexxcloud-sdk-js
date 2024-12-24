declare module 'apexxcloud-sdk-js' {
  interface UploadCallbacks {
    onProgress?: (event: {
      loaded: number;
      total: number;
      progress: number;
      type: string;
    }) => void;
    onComplete?: (event: {
      type: string;
      response: any;
      timestamp: Date;
    }) => void;
    onError?: (event: {
      type: string;
      error: Error;
      status?: number;
      originalEvent?: Event;
      timestamp: Date;
    }) => void;
    onStart?: (event: {
      type: string;
      timestamp: Date;
      file: {
        name: string;
        size: number;
        type: string;
      };
    }) => void;
  }

  interface MultipartUploadCallbacks extends UploadCallbacks {
    onPartStart?: (event: {
      type: string;
      timestamp: Date;
      partNumber: number;
      totalParts: number;
      chunkSize: number;
    }) => void;
    onPartProgress?: (event: {
      type: string;
      timestamp: Date;
      partNumber: number;
      totalParts: number;
      loaded: number;
      total: number;
      progress: number;
    }) => void;
    onPartComplete?: (event: {
      type: string;
      timestamp: Date;
      partNumber: number;
      totalParts: number;
      etag: string;
    }) => void;
    onPartError?: (event: {
      type: string;
      timestamp: Date;
      partNumber: number;
      totalParts: number;
      error: Error;
    }) => void;
  }

  class StorageSDK {
    constructor(config?: Record<string, any>);
    
    files: {
      upload(signedUrl: string, file: File, callbacks?: UploadCallbacks): Promise<any>;
      uploadMultipart(
        file: File,
        config: {
          startUrl: string;
          uploadUrls: string[];
          completeUrl: string;
          partSize?: number;
        } & MultipartUploadCallbacks
      ): Promise<any>;
    };
  }

  export = StorageSDK;
} 