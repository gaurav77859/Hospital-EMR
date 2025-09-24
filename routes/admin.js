const express = require("express");
const adminMiddleware = require("../middleware/admin");
const jwt = require("jsonwebtoken");
const { Admin, Bookapoint, PDFDocument, DiseaseTemplate, MedicalRecord } = require("../db/db");
const router = express.Router();

// FOR ADMIN SIGNUP
router.post('/signup', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      return res.status(400).json({ message: 'Admin already exists' });
    }
    await Admin.create({ username, password });
    res.status(201).json({ message: 'Admin created successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error creating admin' });
  }
});

// FOR ADMIN SIGNIN
router.post('/signin', async (req, res) => {
  const { username, password } = req.body;
  try {
    const admin = await Admin.findOne({ username, password });
    if (admin) {
      const token = jwt.sign(
        { username, role: 'admin' }, 
        process.env.JWT_SECRET || "sonu_server"
      );
      res.json({ token });
    } else {
      res.status(401).json({ message: "Wrong email or password" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error signing in' });
  }
});

// CREATE DISEASE TEMPLATE
router.post('/api/disease-template', adminMiddleware, async (req, res) => {
  try {
    const { diseaseName, keywords, fields } = req.body;
    
    const template = await DiseaseTemplate.create({
      diseaseName,
      keywords,
      fields
    });
    
    res.status(201).json({
      success: true,
      message: 'Disease template created successfully',
      template
    });
  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false,
        message: 'Disease template already exists' 
      });
    }
    res.status(500).json({ 
      success: false,
      message: 'Error creating template' 
    });
  }
});

// GET ALL DISEASE TEMPLATES
router.get('/api/disease-templates', adminMiddleware, async (req, res) => {
  try {
    const templates = await DiseaseTemplate.find().sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: templates.length,
      templates
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// UPDATE DISEASE TEMPLATE
router.put('/api/disease-template/:templateId', adminMiddleware, async (req, res) => {
  try {
    const { diseaseName, keywords, fields } = req.body;
    
    const template = await DiseaseTemplate.findByIdAndUpdate(
      req.params.templateId,
      { diseaseName, keywords, fields },
      { new: true }
    );
    
    if (!template) {
      return res.status(404).json({ 
        success: false,
        message: 'Template not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Template updated successfully',
      template
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      message: 'Error updating template' 
    });
  }
});

// DELETE DISEASE TEMPLATE
router.delete('/api/disease-template/:templateId', adminMiddleware, async (req, res) => {
  try {
    const template = await DiseaseTemplate.findByIdAndDelete(req.params.templateId);
    
    if (!template) {
      return res.status(404).json({ 
        success: false,
        message: 'Template not found' 
      });
    }
    
    res.json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      message: 'Error deleting template' 
    });
  }
});

// GET ALL MEDICAL RECORDS (Admin)
router.get('/api/all-medical-records', adminMiddleware, async (req, res) => {
  try {
    const records = await MedicalRecord.find()
      .populate('patient', 'username')
      .populate('diseaseTemplate', 'diseaseName')
      .populate('pdfDocument', 'originalName uploadedAt')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: records.length,
      records
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// INITIALIZE DEFAULT TEMPLATES
router.post('/api/init-templates', adminMiddleware, async (req, res) => {
  try {
    const defaultTemplates = [
      {
        diseaseName: "Diabetes",
        keywords: ["diabetes", "blood sugar", "glucose", "insulin", "diabetic"],
        fields: [
          {
            fieldName: "blood_sugar_level",
            fieldType: "number",
            required: true,
            extractionPattern: "blood sugar[:\\s]+(\\d+)"
          },
          {
            fieldName: "insulin_type",
            fieldType: "text",
            required: false,
            extractionPattern: "insulin[:\\s]+([^\n\r]+)"
          },
          {
            fieldName: "diagnosis_date",
            fieldType: "date",
            required: false
          }
        ]
      },
      {
        diseaseName: "Hypertension",
        keywords: ["hypertension", "blood pressure", "bp", "high pressure"],
        fields: [
          {
            fieldName: "systolic_pressure",
            fieldType: "number",
            required: true,
            extractionPattern: "systolic[:\\s]+(\\d+)"
          },
          {
            fieldName: "diastolic_pressure",
            fieldType: "number",
            required: true,
            extractionPattern: "diastolic[:\\s]+(\\d+)"
          },
          {
            fieldName: "medication",
            fieldType: "text",
            required: false
          }
        ]
      },
      {
        diseaseName: "Heart Disease",
        keywords: ["heart disease", "cardiac", "heart attack", "coronary", "cardiovascular"],
        fields: [
          {
            fieldName: "heart_rate",
            fieldType: "number",
            required: false,
            extractionPattern: "heart rate[:\\s]+(\\d+)"
          },
          {
            fieldName: "ejection_fraction",
            fieldType: "number",
            required: false
          },
          {
            fieldName: "chest_pain",
            fieldType: "boolean",
            required: false
          }
        ]
      }
    ];

    const createdTemplates = [];
    
    for (const templateData of defaultTemplates) {
      try {
        const existingTemplate = await DiseaseTemplate.findOne({ 
          diseaseName: templateData.diseaseName 
        });
        
        if (!existingTemplate) {
          const template = await DiseaseTemplate.create(templateData);
          createdTemplates.push(template);
        }
      } catch (error) {
        console.log(`Template ${templateData.diseaseName} already exists`);
      }
    }
    
    res.json({
      success: true,
      message: `${createdTemplates.length} templates initialized`,
      templates: createdTemplates
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      success: false,
      message: 'Error initializing templates' 
    });
  }
});

module.exports = router;