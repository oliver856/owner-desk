// Public sign-in settings for the browser. The anon key cannot read any owner table.
import { publicConfig } from './_lib/core.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json(publicConfig);
}
