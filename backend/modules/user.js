import mongoose from 'mongoose'

const UserSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  genre: { type: String, enum: ['male', 'female'] },
  email: { type: String, unique: true, lowercase: true },
  password: String,
  dob: Date,
  preference: { type: String, enum: ['male', 'female', 'all'], default: 'all' },
  interests: [String],
  avatar: String,
  liked: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
})

export default mongoose.model('User', UserSchema)
