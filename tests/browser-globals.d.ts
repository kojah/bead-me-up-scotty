export {};

declare global {
  interface Window {
    __copiedLinks: string[];
    __navigationMarker: string;
    __notifications: Array<{
      title: string;
      options?: NotificationOptions;
      closed: boolean;
      onclick?: (event: Event) => void;
      close(): void;
    }>;
  }
}
