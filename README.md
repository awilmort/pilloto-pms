# Pilloto - Full Stack Web Application

A comprehensive web application for Pilloto, an eco-friendly hotel and aqua park featuring customer reservations, media galleries, and admin management.

## 🌟 Features

### Customer Features

- **Homepage** with photo carousel and resort information
- **Room Browsing** with filtering and availability checking
- **Reservation System** with booking management
- **User Authentication** with registration and login
- **Media Gallery** showcasing facilities and activities
- **Contact Form** for inquiries and support
- **Responsive Design** for all devices

### Admin Features

- **Dashboard** with analytics and statistics
- **Comprehensive Room Management** (Full CRUD operations)
  - Create, edit, and delete rooms
  - Image upload and management
  - Room availability control
  - Amenities and features configuration
  - Advanced filtering and search
  - Cards and table view modes
- **Reservation Management** with status tracking
- **User Management** with role-based access
- **Media Management** for gallery content
- **Contact Management** with response system
- **Analytics & Reporting**

## 🛠️ Tech Stack

### Frontend

- **React.js** with TypeScript
- **Material-UI** or **Tailwind CSS** for styling
- **React Router** for navigation
- **Axios** for API communication
- **React Hook Form** for form handling
- **React Query** for state management

### Backend

- **Node.js** with Express.js
- **TypeScript** for type safety
- **MongoDB** with Mongoose ODM
- **JWT** for authentication
- **Multer** for file uploads
- **Helmet** for security headers
- **Rate Limiting** for API protection

### Security

- **bcryptjs** for password hashing
- **CORS** configuration
- **Input validation** with express-validator
- **Role-based access control**
- **File upload security**

## 📁 Project Structure

```
pilloto-pms/
├── frontend/                # React.js frontend application
│   ├── public/             # Static assets
│   ├── src/
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── services/       # API services
│   │   ├── utils/          # Utility functions
│   │   └── types/          # TypeScript types
│   ├── package.json
│   └── tsconfig.json
├── backend/                # Node.js backend API
│   ├── src/
│   │   ├── models/         # Mongoose models
│   │   ├── routes/         # Express routes
│   │   ├── middleware/     # Custom middleware
│   │   ├── utils/          # Utility functions
│   │   ├── scripts/        # Database scripts
│   │   └── types/          # TypeScript types
│   ├── uploads/            # File upload directory
│   ├── package.json
│   └── tsconfig.json
└── README.md              # This file
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v16 or higher)
- **MongoDB** (local installation or MongoDB Atlas)
- **Git**

### Installation

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd pilloto-pms
   ```

2. **Backend Setup:**

   ```bash
   cd backend
   npm install

   # Copy environment file and configure
   cp .env.example .env
   # Edit .env with your configuration

   # Seed the database with sample data
   npm run seed

   # Start development server
   npm run dev
   ```

3. **Frontend Setup:**

   ```bash
   cd ../frontend
   npm install

   # Start development server
   npm start
   ```

### Environment Configuration

#### Backend (.env)

```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000
MONGODB_URI=mongodb://localhost:27017/pilloto_pms
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d
```

#### Frontend (.env)

```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_ENVIRONMENT=development
```

## 📋 Development Scripts

### Backend

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run seed` - Seed database with sample data

### Frontend

- `npm start` - Start development server
- `npm run build` - Build for production
- `npm test` - Run tests
- `npm run eject` - Eject from Create React App

## 🔗 API Endpoints

### Authentication

- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile

### Rooms

- `GET /api/rooms` - Get all rooms
- `GET /api/rooms/:id` - Get single room
- `POST /api/rooms` - Create room (Admin)
- `PUT /api/rooms/:id` - Update room (Admin)

### Reservations

- `GET /api/reservations` - Get user reservations
- `POST /api/reservations` - Create reservation
- `PUT /api/reservations/:id/cancel` - Cancel reservation

### Media

- `GET /api/media` - Get media gallery
- `GET /api/media/featured` - Get featured media
- `POST /api/media/upload` - Upload media (Admin)

### Contact

- `POST /api/contact` - Submit contact form
- `GET /api/contact` - Get contacts (Admin)

### Admin

- `GET /api/admin/dashboard` - Dashboard statistics
- `GET /api/admin/users` - User management
- `GET /api/admin/analytics` - Analytics data

## 🔐 Default Accounts

After running the seed script:

**Admin Account:**

- Email: `admin@pilloto.com`
- Password: `admin123`

**Customer Account:**

- Email: `john.doe@example.com`
- Password: `customer123`

## 🌐 Deployment

### Backend Deployment

1. Build the application: `npm run build`
2. Set production environment variables
3. Deploy to your preferred hosting service (Heroku, AWS, DigitalOcean)

### Frontend Deployment

1. Build the application: `npm run build`
2. Deploy the `build` folder to a static hosting service (Netlify, Vercel, AWS S3)

### Database

- For production, use MongoDB Atlas or a dedicated MongoDB server
- Update the `MONGODB_URI` environment variable accordingly

## 🔧 VS Code Configuration

Recommended extensions:

- TypeScript and JavaScript Language Features
- ES7+ React/Redux/React-Native snippets
- Auto Rename Tag
- Bracket Pair Colorizer
- GitLens
- Thunder Client (for API testing)

## 📝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit your changes: `git commit -am 'Add new feature'`
4. Push to the branch: `git push origin feature/new-feature`
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For support, email support@pilloto.com or create an issue in the repository.

---

**Pilloto** - _Your Eco-Friendly Paradise_ 🌺
