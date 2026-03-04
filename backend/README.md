# Pilloto - Backend API

This is the backend API server for the Pilloto eco-friendly hotel and aqua park web application.

## Features

- **Authentication & Authorization**: JWT-based authentication with role-based access control
- **Room Management**: CRUD operations for hotel rooms with availability checking
- **Reservation System**: Complete booking system with status tracking
- **Media Gallery**: File upload and management for images and videos
- **Contact System**: Contact form submissions with admin response functionality
- **Admin Panel**: Comprehensive admin dashboard with analytics
- **Security**: Rate limiting, CORS, helmet security headers
- **Database**: MongoDB with Mongoose ODM

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: MongoDB with Mongoose
- **Authentication**: JWT (JSON Web Tokens)
- **Security**: Helmet, CORS, Rate Limiting
- **File Upload**: Multer
- **Validation**: Express Validator
- **Password Hashing**: bcryptjs

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user profile
- `PUT /api/auth/profile` - Update user profile
- `PUT /api/auth/change-password` - Change password

### Rooms

- `GET /api/rooms` - Get all rooms (with filtering)
- `GET /api/rooms/:id` - Get single room
- `POST /api/rooms` - Create room (Admin only)
- `PUT /api/rooms/:id` - Update room (Admin only)
- `DELETE /api/rooms/:id` - Delete room (Admin only)
- `GET /api/rooms/:id/availability` - Check room availability

### Reservations

- `GET /api/reservations` - Get user's reservations
- `GET /api/reservations/:id` - Get single reservation
- `POST /api/reservations` - Create new reservation
- `PUT /api/reservations/:id/cancel` - Cancel reservation
- `PUT /api/reservations/:id/status` - Update reservation status (Admin)

### Media

- `GET /api/media` - Get media files
- `GET /api/media/featured` - Get featured media
- `GET /api/media/categories` - Get media by categories
- `POST /api/media/upload` - Upload media file (Admin/Staff)
- `PUT /api/media/:id` - Update media metadata (Admin/Staff)
- `DELETE /api/media/:id` - Delete media file (Admin)

### Contact

- `POST /api/contact` - Submit contact form
- `GET /api/contact` - Get all contacts (Admin/Staff)
- `GET /api/contact/:id` - Get single contact (Admin/Staff)
- `PUT /api/contact/:id/respond` - Respond to contact (Admin/Staff)
- `PUT /api/contact/:id/status` - Update contact status (Admin/Staff)
- `DELETE /api/contact/:id` - Delete contact (Admin)

### Admin

- `GET /api/admin/dashboard` - Get dashboard statistics
- `GET /api/admin/users` - Get all users
- `PUT /api/admin/users/:id` - Update user details
- `DELETE /api/admin/users/:id` - Delete user
- `GET /api/admin/analytics` - Get analytics data
- `POST /api/admin/backup` - Create database backup

## Setup Instructions

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.example` to `.env` and configure:

   ```bash
   cp .env.example .env
   ```

   Update the following variables:
   - `MONGODB_URI` - MongoDB connection string
   - `JWT_SECRET` - JWT secret key (use a strong random string)
   - `FRONTEND_URL` - Frontend application URL
   - Other optional services (email, cloudinary, stripe)

3. **Database Setup**
   - Install MongoDB locally or use MongoDB Atlas
   - Create a database named `pilloto_pms`
   - Update `MONGODB_URI` in `.env` file

4. **Development**

   ```bash
   npm run dev
   ```

   Server will start on http://localhost:5000

5. **Production Build**
   ```bash
   npm run build
   npm start
   ```

## Project Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Route controllers (if needed)
├── middleware/      # Custom middleware
│   ├── auth.ts      # Authentication middleware
│   └── validation.ts # Validation middleware
├── models/          # Mongoose models
│   ├── User.ts      # User model
│   ├── Room.ts      # Room model
│   ├── Reservation.ts # Reservation model
│   ├── Media.ts     # Media model
│   └── Contact.ts   # Contact model
├── routes/          # API routes
│   ├── auth.ts      # Authentication routes
│   ├── rooms.ts     # Room routes
│   ├── reservations.ts # Reservation routes
│   ├── media.ts     # Media routes
│   ├── contact.ts   # Contact routes
│   └── admin.ts     # Admin routes
├── utils/           # Utility functions
│   └── jwt.ts       # JWT utilities
└── index.ts         # Main application file
```

## Security Features

- **Rate Limiting**: Prevents API abuse
- **CORS**: Configured for frontend domain
- **Helmet**: Security headers
- **JWT Authentication**: Secure token-based auth
- **Password Hashing**: bcrypt with salt rounds
- **Input Validation**: Express Validator
- **File Upload Security**: File type validation
- **Role-based Access**: Admin, Staff, Customer roles

## Development Notes

- TypeScript is used for type safety
- All routes have proper error handling
- Database queries use proper indexing
- File uploads are handled securely
- API responses follow consistent format
- Logging is implemented for debugging

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.
