declare module '@apexxcloud/sdk-js' {
  type SignedUrlType = 'upload' | 'start-multipart' | 'uploadpart' | 'completemultipart' | 'cancelmultipart';
  
  interface SignedUrlOptions {
    key: string;
    mimeType?: string;
    totalParts?: number;
    partNumber?: number;
    uploadId?: string;
    visibility?: 'public' | 'private';
  }

  type GetSignedUrlFn = (type: SignedUrlType, options: SignedUrlOptions) => Promise<string>;

  interface BaseEvent {
    type: string;
    timestamp: Date;
  }

  interface FileInfo {
    name: string;
    size: number;
    type: string;
  }

  interface ProgressEvent extends BaseEvent {
    loaded: number;
    total: number;
    progress: number;
  }

  interface MultipartProgressEvent extends ProgressEvent {
    part: {
      number: number;
      progress: number;
    };
  }

  interface StartEvent extends BaseEvent {
    file: FileInfo;
  }

  interface CompleteEvent extends BaseEvent {
    response: any;
    file: FileInfo;
  }

  interface ErrorEvent extends BaseEvent {
    error: Error;
    status?: number;
    phase?: 'start' | 'upload' | 'complete' | 'cancel';
  }

  interface UploadOptions {
    signal?: AbortSignal;
    onProgress?: (event: ProgressEvent) => void;
    onComplete?: (event: CompleteEvent) => void;
    onError?: (event: ErrorEvent) => void;
    onStart?: (event: StartEvent) => void;
  }

  interface MultipartUploadOptions extends UploadOptions {
    onProgress?: (event: MultipartProgressEvent) => void;
    onPartComplete?: (part: { ETag: string; PartNumber: number }) => void;
    partSize?: number;
    concurrency?: number;
  }

  export default class ApexxCloud {
    constructor(config?: {
      baseUrl?: string;
    });
    
    files: {
      upload(
        file: File,
        getSignedUrl: GetSignedUrlFn,
        options?: UploadOptions
      ): Promise<any>;
      
      uploadMultipart(
        file: File,
        getSignedUrl: GetSignedUrlFn,
        options?: MultipartUploadOptions
      ): Promise<any>;
    };
  }
} 