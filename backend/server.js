import dotenv from 'dotenv'
import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import User from './modules/user.js'
import Match from './modules/match.js'
import { fileURLToPath } from 'url'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET

app.use(cors({ 
  origin: ["https://datting-app-backend.onrender.com"]
}))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'))
}

// multer setup
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'uploads'))
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  },
})
const upload = multer({ storage })

// connect to mongo
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    console.log('MongoDB connected')
  } catch (err) {
    console.log('Error connecting to MongoDB:', err)
  }
}
connectDB()

// auth middleware
const auth = async (req, res, next) => {
  const header = req.headers.authorization
  
  if (!header) {
    return res.status(401).json({ message: 'No token' })
  }
  
  const token = header.split(' ')[1]
  
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = await User.findById(payload.id).select('-password')
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' })
    }
    
    req.user = user
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' })
  }
}

// register with optional avatar
app.post('/api/register', upload.single('avatar'), async (req, res) => {
  try {
    const { firstName, lastName, genre, email, password, dob, preference } = req.body
    
    if (!firstName || !lastName || !genre || !email || !password || !dob || !preference) {
      return res.status(400).json({ message: 'Missing fields' })
    }
    
    const hashed = await bcrypt.hash(password, 10)
    const userData = {
      firstName,
      lastName,
      genre,
      email,
      password: hashed,
      dob: new Date(dob),
      preference: preference || 'all',
    }
    
    if (req.file) {
      userData.avatar = '/uploads/' + req.file.filename
    }
    
    const user = await User.create(userData)
    const token = jwt.sign({ id: user._id }, JWT_SECRET)
    
    res.json({ 
      token, 
      user: { 
        _id: user._id, 
        firstName: user.firstName, 
        avatar: user.avatar 
      } 
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await User.findOne({ email })
    
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' })
    }
    
    const ok = await bcrypt.compare(password, user.password)
    
    if (!ok) {
      return res.status(400).json({ message: 'Invalid credentials' })
    }
    
    const token = jwt.sign({ id: user._id }, JWT_SECRET)
    
    res.json({ 
      token, 
      user: { 
        _id: user._id, 
        firstName: user.firstName, 
        avatar: user.avatar 
      } 
    })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// get my profile
app.get('/api/users/me', auth, (req, res) => {
  res.json(req.user)
})

// update profile/interests
app.put('/api/users/me', auth, async (req, res) => {
  const updates = req.body
  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true })
    .select('-password')
  
  res.json(user)
})

// get candidates
app.get('/api/users', auth, async (req, res) => {
  const me = await User.findById(req.user._id)
  const excluded = [me._id, ...(me.liked || [])]

  // Construir query baseada na preferência do usuário
  const query = {
    _id: { $nin: excluded },
  }

  // Adicionar filtro por gênero se a preferência não for 'all'
  if (me.preference && me.preference !== 'all') {
    query.genre = me.preference
  }

  const candidates = await User.find(query).limit(50).select('-password -liked -likedBy')

  res.json(candidates)
})

// like
app.post('/api/like', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user._id)
    const { targetId } = req.body
    
    if (!targetId) {
      return res.status(400).json({ message: 'targetId required' })
    }
    
    if (me._id.equals(targetId)) {
      return res.status(400).json({ message: 'Cannot like yourself' })
    }
    
    const target = await User.findById(targetId)
    
    if (!target) {
      return res.status(404).json({ message: 'User not found' })
    }

    if (!me.liked) {
      me.liked = []
    }
    
    if (!me.liked.find(id => id.toString() === target._id.toString())) {
      me.liked.push(target._id)
      await me.save()
    }

    if (!target.likedBy) {
      target.likedBy = []
    }
    
    if (!target.likedBy.find(id => id.toString() === me._id.toString())) {
      target.likedBy.push(me._id)
      await target.save()
    }

    const mutual = target.liked && target.liked.find(id => id.toString() === me._id.toString())
    
    if (mutual) {
      const exists = await Match.findOne({
        $or: [
          { userA: me._id, userB: target._id },
          { userA: target._id, userB: me._id },
        ],
      })
      
      if (!exists) {
        const match = await Match.create({ userA: me._id, userB: target._id })
        return res.json({ message: "It's a match!", match })
      }
    }

    res.json({ message: 'Liked' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

// get matches
app.get('/api/matches', auth, async (req, res) => {
  const userId = req.user._id
  const matches = await Match.find({ $or: [{ userA: userId }, { userB: userId }] })
    .populate('userA', 'firstName lastName avatar')
    .populate('userB', 'firstName lastName avatar')
    .sort({ createdAt: -1 })
  res.json(matches)
})

// get all users
app.get('/api/users/all', auth, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('-password -liked -likedBy')
      .limit(50)
    res.json(users)
  } catch (err) {
    console.error(err)
    res.status(500).json({ message: 'Server error' })
  }
})

app.listen(PORT, () => console.log('Server listening on', PORT))
