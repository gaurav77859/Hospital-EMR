const mongoose = require('mongoose');

mongoose.connect(
  process.env.MONGO_URI || 'mongodb+srv://Zerodha:Shayam@zerodha.tjlbwfw.mongodb.net/zerodha?retryWrites=true&w=majority&appName=Zerodha',
  {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch((err) => {
  console.error('❌ MongoDB connection error:', err);
});

// Schemas
const AdminSchema = new mongoose.Schema({
  username: String,
  password: String
});

const UserSchema = new mongoose.Schema({
  username: String,
  password: String,
});

const BookapointSchema = new mongoose.Schema({
  username: String,
  age: String,
  gender: String,
  place: String,
  userID: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User" 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Disease Templates Schema
const DiseaseTemplateSchema = new mongoose.Schema({
  diseaseName: {
    type: String,
    required: true,
    unique: true
  },
  keywords: [String],
  fields: [{
    fieldName: String,
    fieldType: String, // text, number, date, boolean
    required: Boolean,
    extractionPattern: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// PDF Document Schema
const PDFDocumentSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  path: String,
  size: Number,
  mimetype: String,
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  description: String,
  extractedText: String,
  processedAt: Date,
  processingStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  }
});

// Medical Records Schema
const MedicalRecordSchema = new mongoose.Schema({
  pdfDocument: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "PDFDocument",
    required: true
  },
  patient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  diseaseTemplate: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "DiseaseTemplate",
    required: true
  },
  diseaseName: String,
  extractedData: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  },
  confidence: Number,
  createdAt: {
    type: Date,
    default: Date.now
  },
  verified: {
    type: Boolean,
    default: false
  }
});

// Models
const User = mongoose.model('User', UserSchema);
const Admin = mongoose.model('Admin', AdminSchema);
const Bookapoint = mongoose.model('Bookapoint', BookapointSchema);
const PDFDocument = mongoose.model('PDFDocument', PDFDocumentSchema);
const DiseaseTemplate = mongoose.model('DiseaseTemplate', DiseaseTemplateSchema);
const MedicalRecord = mongoose.model('MedicalRecord', MedicalRecordSchema);

module.exports = {
  Admin,
  User,
  Bookapoint,
  PDFDocument,
  DiseaseTemplate,
  MedicalRecord
};
