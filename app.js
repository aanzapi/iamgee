require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ SUPABASE SETUP ============
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Checking Supabase:');
console.log('  URL:', supabaseUrl ? '✅ OK' : '❌ MISSING');
console.log('  Key:', supabaseKey ? '✅ OK' : '❌ MISSING');

const supabase = createClient(supabaseUrl, supabaseKey);

// ============ MIDDLEWARE ============
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============ MULTER SETUP ============
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format tidak didukung. Gunakan JPG, PNG, atau WEBP.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: fileFilter
});

// ============ FUNGSI BANTU ============
function generateFilename(originalname) {
  const ext = path.extname(originalname);
  const uuid = uuidv4().replace(/-/g, '');
  return `${uuid}${ext}`;
}

// ============ ROUTES ============

// Halaman Utama
app.get('/', async (req, res) => {
  try {
    // Ambil semua gambar dari database
    const { data: images, error } = await supabase
      .from('images')
      .select('*')
      .order('uploaded_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.render('index', {
      title: 'Image Hosting',
      images: images || [],
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      error: null
    });
  } catch (error) {
    console.error('Error:', error);
    res.render('index', {
      title: 'Image Hosting',
      images: [],
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      error: 'Gagal memuat gambar'
    });
  }
});

// API Upload
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Tidak ada file' });
    }

    const file = req.file;
    const filename = generateFilename(file.originalname);
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    // Upload ke Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600'
      });

    if (uploadError) throw uploadError;

    // Simpan metadata ke database
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

// Tampilkan Gambar
app.get('/:filename', async (req, res) => {
  try {
    const { filename } = req.params;

    // Cek di database
    const { data: image, error } = await supabase
      .from('images')
      .select('*')
      .eq('filename', filename)
      .single();

    if (error || !image) {
      return res.status(404).send('Gambar tidak ditemukan');
    }

    // Download dari storage
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

// Hapus Gambar (Admin)
app.delete('/api/image/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Ambil data gambar
    const { data: image, error: getError } = await supabase
      .from('images')
      .select('*')
      .eq('id', id)
      .single();

    if (getError || !image) {
      return res.status(404).json({ success: false, error: 'Gambar tidak ditemukan' });
    }

    // Hapus dari storage
    await supabase.storage.from('images').remove([image.filename]);

    // Hapus dari database
    await supabase.from('images').delete().eq('id', id);

    res.json({ success: true, message: 'Gambar berhasil dihapus' });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ success: false, error: 'Gagal menghapus' });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: {
      url: supabaseUrl ? 'configured' : 'missing'
    }
  });
});

// ============ START SERVER ============
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
});
