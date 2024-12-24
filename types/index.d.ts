declare module '@apexxcloud/sdk-js' {
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

 
  export  default class StorageSDK {
    constructor(config?: Record<string, any>);
    
    files: {
      upload(signedUrl: string, file: File, callbacks?: UploadCallbacks): Promise<any>;
      
    };
  }


} 