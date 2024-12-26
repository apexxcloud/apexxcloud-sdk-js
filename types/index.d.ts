declare module '@apexxcloud/sdk-js' {
  interface UploadOptions {
    signal?: AbortSignal;
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

 
  export  default class ApexxCloud {
    constructor(config?: Record<string, any>);
    
    files: {
      upload(signedUrl: string, file: File, options?: UploadOptions): Promise<any>;
      
    };
  }


} 