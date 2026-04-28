import { record } from './state';

const SECURE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export async function invoke<T = unknown>(command: string, args?: unknown): Promise<T> {
  record({ type: 'invoke', command, args });

  switch (command) {
    case 'get_or_create_secure_key':
      return SECURE_KEY as T;
    case 'set_secure_key':
    case 'set_close_to_tray':
    case 'plugin:autostart|enable':
    case 'plugin:autostart|disable':
    case 'update_server_config':
    case 'save_cli_config':
    case 'cancel_batch_check':
    case 'pause_batch_check':
    case 'resume_batch_check':
    case 'register_global_shortcut':
    case 'unregister_global_shortcut':
      return undefined as T;
    case 'plugin:autostart|is_enabled':
      return false as T;
    case 'get_executable_path':
      return 'C:\\PicNexus\\PicNexus.exe' as T;
    case 'encrypt_webdav_password':
      return 'encrypted-webdav-password' as T;
    case 'decrypt_webdav_password':
      return '' as T;
    case 'check_image_link':
      return {
        is_valid: true,
        status_code: 200,
        response_time: 12,
      } as T;
    case 'batch_check_links':
      return {
        total: 0,
        valid: 0,
        invalid: 0,
        timeout: 0,
        suspicious: 0,
        elapsed_ms: 1,
        cancelled: false,
        results: [],
      } as T;
    case 'get_clipboard_image':
      return null as T;
    case 'download_url_to_temp':
      return null as T;
    default:
      return undefined as T;
  }
}
