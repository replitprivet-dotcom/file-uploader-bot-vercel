const { ObjectId, GridFSBucket } = require('mongodb');
const { getDb } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).send('Method not allowed');
  const id = String(req.query.id || '');
  if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(404).send('File nahi mili');

  try {
    const db = await getDb();
    const bucket = new GridFSBucket(db, { bucketName: 'permanent_files' });
    const file = await db.collection('permanent_files.files').findOne({ _id: new ObjectId(id) });
    if (!file) return res.status(404).send('File nahi mili');

    const contentType = file.metadata && file.metadata.contentType;
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(file.length));
    res.setHeader('Content-Disposition', `attachment; filename="${String(file.filename || 'file').replace(/[^A-Za-z0-9._ -]/g, '_')}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (req.method === 'HEAD') return res.status(200).end();

    const stream = bucket.openDownloadStream(new ObjectId(id));
    stream.on('error', (err) => {
      console.error('GridFS download error:', err.message);
      if (!res.headersSent) res.status(500).end('Download error');
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (err) {
    console.error('Download error:', err.message);
    return res.status(500).send('File load nahi ho payi');
  }
};

module.exports.config = { api: { responseLimit: false } };
