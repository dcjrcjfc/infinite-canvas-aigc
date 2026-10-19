import { fixWebmDuration } from '@fix-webm-duration/fix';
window.MediaEncoding = { fixDuration: (blob, milliseconds) => fixWebmDuration(blob, milliseconds, { logger:false }) };
