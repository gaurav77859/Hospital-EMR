const express = require("express");
const userMiddleware = require("../middleware/user");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs-extra");
const { User, Bookapoint, PDFDocument, MedicalRecord, DiseaseTemplate } = require("../db/db");
const pdfProcessor = require("../service/pdfProcessor");
const router = express.Router();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
fs.ensureDirSync(uploadsDir);

// Multer configuration for PDF uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// FOR USER SIGNUP
router.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }
    const newUser = await User.create({ username, password });
    res.status(201).json({ 
      message: 'User created successfully', 
      userId: newUser._id 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

// FOR USER SIGNIN
router.post("/signin", async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username, password });
    if (user) {
      const token = jwt.sign(
        { username, userId: user._id }, 
        process.env.JWT_SECRET || "sonu_server"
      );
      res.json({ 
        token, 
        userId: user._id, 
        username: user.username 
      });
    } else {
      res.status(401).json({ message: "Wrong email or password" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error signing in' });
  }
});

// UPLOAD PDF WITH AUTOMATIC PROCESSING
router.post("/api/upload-pdf", userMiddleware, upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false,
        message: "No PDF file uploaded" 
      });
    }

    // Create PDF document record
    const pdfDocument = await PDFDocument.create({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedBy: req.userId,
      description: req.body.description || '',
      processingStatus: 'pending'
    });

    // Process PDF asynchronously
    setImmediate(async () => {
      try {
        const pdfBuffer = await fs.readFile(req.file.path);
        await pdfProcessor.processPDF(pdfDocument._id, pdfBuffer, req.userId);
      } catch (error) {
        console.error('PDF processing error:', error);
      }
    });

    res.status(201).json({
      success: true,
      message: "PDF uploaded successfully and is being processed",
      document: {
        id: pdfDocument._id,
        filename: pdfDocument.originalName,
        size: pdfDocument.size,
        uploadedAt: pdfDocument.uploadedAt,
        processingStatus: pdfDocument.processingStatus
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      message: "Error uploading PDF" 
    });
  }
});

// GET MEDICAL RECORDS (FILLED TEMPLATES)
router.get("/api/medical-records", userMiddleware, async (req, res) => {
  try {
    const records = await MedicalRecord.find({ patient: req.userId })
      .populate('diseaseTemplate', 'diseaseName fields')
      .populate('pdfDocument', 'originalName uploadedAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: records.length,
      records: records.map(record => ({
        id: record._id,
        diseaseName: record.diseaseName,
        confidence: record.confidence,
        extractedData: Object.fromEntries(record.extractedData),
        pdfDocument: record.pdfDocument,
        template: record.diseaseTemplate,
        createdAt: record.createdAt,
        verified: record.verified
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET SPECIFIC MEDICAL RECORD
router.get("/api/medical-record/:recordId", userMiddleware, async (req, res) => {
  try {
    const record = await MedicalRecord.findOne({
      _id: req.params.recordId,
      patient: req.userId
    })
    .populate('diseaseTemplate')
    .populate('pdfDocument');

    if (!record) {
      return res.status(404).json({ 
        success: false,
        message: "Medical record not found" 
      });
    }

    res.json({
      success: true,
      record: {
        id: record._id,
        diseaseName: record.diseaseName,
        confidence: record.confidence,
        extractedData: Object.fromEntries(record.extractedData),
        pdfDocument: record.pdfDocument,
        template: record.diseaseTemplate,
        createdAt: record.createdAt,
        verified: record.verified
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET RECORDS BY DISEASE
router.get("/api/medical-records/disease/:diseaseName", userMiddleware, async (req, res) => {
  try {
    const records = await MedicalRecord.find({ 
      patient: req.userId,
      diseaseName: new RegExp(req.params.diseaseName, 'i')
    })
    .populate('diseaseTemplate', 'diseaseName fields')
    .populate('pdfDocument', 'originalName uploadedAt')
    .sort({ createdAt: -1 });

    res.json({
      success: true,
      diseaseName: req.params.diseaseName,
      count: records.length,
      records: records.map(record => ({
        id: record._id,
        diseaseName: record.diseaseName,
        confidence: record.confidence,
        extractedData: Object.fromEntries(record.extractedData),
        pdfDocument: record.pdfDocument,
        createdAt: record.createdAt,
        verified: record.verified
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET PROCESSING STATUS OF PDF
router.get("/api/pdf-status/:pdfId", userMiddleware, async (req, res) => {
  try {
    const pdf = await PDFDocument.findOne({
      _id: req.params.pdfId,
      uploadedBy: req.userId
    });

    if (!pdf) {
      return res.status(404).json({ 
        success: false,
        message: "PDF not found" 
      });
    }

    res.json({
      success: true,
      status: {
        processingStatus: pdf.processingStatus,
        processedAt: pdf.processedAt,
        hasExtractedText: !!pdf.extractedText
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// CREATE BOOKING APPOINTMENT
router.post("/api/Bookapoint", userMiddleware, async (req, res) => {
  const { username, age, place, gender } = req.body;
  
  try {
    const newBooking = await Bookapoint.create({
      username,
      age,
      place,
      gender,
      userID: req.userId
    });
    res.status(201).json({ 
      message: "BOOKING DONE",
      booking: newBooking 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "SOMETHING WENT WRONG" });
  }
});

// GET USER'S UPLOADED PDFS
router.get("/api/my-pdfs", userMiddleware, async (req, res) => {
  try {
    const pdfs = await PDFDocument.find({ uploadedBy: req.userId })
      .sort({ uploadedAt: -1 })
      .select('-path -extractedText'); // Don't send file path and text for security
    
    res.json({ 
      success: true, 
      count: pdfs.length,
      pdfs 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// GET ALL BOOKINGS FOR A USER
router.get("/api/my-bookings", userMiddleware, async (req, res) => {
  try {
    const bookings = await Bookapoint.find({ userID: req.userId });
    res.json({ 
      success: true, 
      count: bookings.length,
      bookings 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;