const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

const app = express();
const port = 3000;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Keep original filename with timestamp
        const timestamp = Date.now();
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        cb(null, `${timestamp}-${originalName}`);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.epub')) {
            cb(null, true);
        } else {
            cb(new Error('Only .epub files are allowed'));
        }
    }
});

// Serve static files
app.use(express.static(__dirname));

// Upload and process endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: '没有上传文件' });
    }

    const filePath = req.file.path;
    const scriptPath = path.join(__dirname, '切书神技.zsh');
    
    // Get original filename without timestamp
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const cleanOutputDir = path.join(__dirname, originalName.replace('.epub', ''));
    
    // Make sure script is executable
    fs.chmodSync(scriptPath, '755');

    console.log(`Processing file: ${filePath}`);

    // Execute the script
    exec(`"${scriptPath}" "${filePath}"`, { 
        cwd: __dirname,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    }, (error, stdout, stderr) => {
        if (error) {
            console.error('Error:', error);
            console.error('stderr:', stderr);
            
            // Clean up uploaded file
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error('Failed to clean up file:', e);
            }
            
            return res.status(500).json({ 
                success: false, 
                error: `处理失败: ${error.message}`,
                details: stderr
            });
        }

        console.log('stdout:', stdout);
        
        // Get output directory (with timestamp from uploaded file)
        const outputDir = filePath.replace('.epub', '');
        
        // Rename to clean directory name (without timestamp)
        try {
            if (fs.existsSync(outputDir) && outputDir !== cleanOutputDir) {
                // If clean directory already exists, remove it first
                if (fs.existsSync(cleanOutputDir)) {
                    fs.rmSync(cleanOutputDir, { recursive: true, force: true });
                }
                // Rename to clean name
                fs.renameSync(outputDir, cleanOutputDir);
                console.log(`Renamed: ${outputDir} -> ${cleanOutputDir}`);
            }
        } catch (renameError) {
            console.error('Failed to rename directory:', renameError);
            // If rename fails, continue with original name
        }
        
        // Use the clean directory name for response
        const finalOutputDir = fs.existsSync(cleanOutputDir) ? cleanOutputDir : outputDir;
        
        // Check if output directory exists
        if (!fs.existsSync(finalOutputDir)) {
            // Clean up uploaded file
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error('Failed to clean up file:', e);
            }
            
            return res.status(500).json({ 
                success: false, 
                error: '输出目录不存在，处理可能失败' 
            });
        }

        // Get chapter list
        const txtDir = path.join(finalOutputDir, 'txt');
        let chapters = [];
        
        try {
            if (fs.existsSync(txtDir)) {
                chapters = fs.readdirSync(txtDir)
                    .filter(f => f.endsWith('.txt'))
                    .map(f => f.replace('.txt', ''));
            }
        } catch (e) {
            console.error('Failed to read chapters:', e);
        }

        // Clean up uploaded file
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            console.error('Failed to clean up file:', e);
        }

        res.json({ 
            success: true, 
            outputDir: finalOutputDir,
            chapters: chapters,
            message: '处理完成'
        });
    });
});

// Download endpoint - creates a zip of the output directory
app.get('/download', async (req, res) => {
    const outputDir = req.query.path;
    
    if (!outputDir || !fs.existsSync(outputDir)) {
        return res.status(404).json({ error: '目录不存在' });
    }

    const zipName = `${path.basename(outputDir)}.zip`;
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    archive.on('error', (err) => {
        console.error('Archive error:', err);
        res.status(500).send({ error: err.message });
    });

    archive.pipe(res);
    archive.directory(outputDir, path.basename(outputDir));
    archive.finalize();
});

// Cleanup endpoint - removes processed directories
app.delete('/cleanup', (req, res) => {
    const uploadsDir = path.join(__dirname, 'uploads');
    
    if (fs.existsSync(uploadsDir)) {
        const files = fs.readdirSync(__dirname);
        
        files.forEach(file => {
            const fullPath = path.join(__dirname, file);
            const stat = fs.statSync(fullPath);
            
            // Remove directories that match the pattern (processed epub outputs)
            if (stat.isDirectory() && 
                !['uploads', 'node_modules', '.git'].includes(file) &&
                file.includes('-')) {
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                    console.log(`Cleaned up: ${file}`);
                } catch (e) {
                    console.error(`Failed to remove ${file}:`, e);
                }
            }
        });
    }
    
    res.json({ success: true, message: '清理完成' });
});

app.listen(port, () => {
    console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║      📚 EPUB 切书工具服务器已启动                  ║
║                                                   ║
║      🌐 访问地址: http://localhost:${port}           ║
║                                                   ║
║      ✨ 拖入你的 EPUB 文件开始处理吧！              ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);
});
