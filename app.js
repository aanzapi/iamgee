const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ SUPABASE - HARDCODE DULU ============
// GANTI DENGAN CREDENTIALS ANDA!
const supabaseUrl = 'https://YOUR_PROJECT_ID.supabase.co';
const supabaseKey = 'YOUR_SERVICE_ROLE_KEY';

console.log('🔍 Checking Supabase:');
console.log('  URL:', supabaseUrl ? '✅ OK' : '❌ MISSING');
console.log('  Key:', supabaseKey ? '✅ OK' : '❌ MISSING');

const supabase = createClient(supabaseUrl, supabaseKey);

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============ MULTER ============
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format tidak didukung'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// ============ FUNGSI ============
function generateFilename(originalname) {
  const ext = path.extname(originalname);
  const uuid = uuidv4().replace(/-/g, '');
  return `${uuid}${ext}`;
}

// ============ ROUTES ============

// Home
app.get('/', async (req, res) => {
  try {
    const { data: images, error } = await supabase
      .from('images')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.render('index', {
      title: 'Image Hosting',
      images: images || [],
      baseUrl: 'https://aanzload.my.id', // GANTI DENGAN DOMAIN ANDA
      error: null
    });
  } catch (error) {
    console.error('Error:', error);
    res.render('index', {
      title: 'Image Hosting',
      images: [],
      baseUrl: 'https://aanzload.my.id',
      error: error.message || 'Gagal memuat gambar'
    });
  }
});

// Upload
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Tidak ada file' });
    }

    const file = req.file;
    const filename = generateFilename(file.originalname);
    const baseUrl = 'https://aanzload.my.id'; // GANTI DENGAN DOMAIN ANDA

    // Upload ke storage
    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600'
      });

    if (uploadError) throw uploadError;

    // Simpan metadata
    const { data, error: dbError } = await supabase
      .from('images')
      .insert([{
        filename: filename,
        original_name: file.originalname,
        storage_path: filename,
        public_url: `${baseUrl}/${filename}`,
        size: file.size,
        mime_type: file.mimetype
      }])
      .select()
      .single();

    if (dbError) throw dbError;

    res.json({
      success: true,
      url: `${baseUrl}/${filename}`
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Upload gagal'
    });
  }
});

// Tampilkan gambar
app.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    const { data: image, error } = await supabase
      .from('images')
      .select('*')
      .eq('filename', filename)
      .single();

    if (error || !image) {
      return res.status(404).send('Gambar tidak ditemukan');
    }

    const { data, error: downloadError } = await supabase.storage
      .from('images')
      .download(filename);

    if (downloadError) throw downloadError;

    res.set('Content-Type', image.mime_type);
    res.set('Cache-Control', 'public, max-age=31536000');
    res.send(data);

  } catch (error) {
    console.error('Error:', error);
    res.status(404).send('Gambar tidak ditemukan');
  }
});

// Hapus gambar
app.delete('/api/image/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: image, error: getError } = await supabase
      .from('images')
      .select('*')
      .eq('id', id)
      .single();

    if (getError || !image) {
      return res.status(404).json({ success: false, error: 'Gambar tidak ditemukan' });
    }

    await supabase.storage.from('images').remove([image.filename]);
    await supabase.from('images').delete().eq('id', id);

    res.json({ success: true, message: 'Gambar berhasil dihapus' });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, error: 'Gagal menghapus' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: supabaseUrl ? 'connected' : 'not configured'
  });
});

// ============ START ============
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
