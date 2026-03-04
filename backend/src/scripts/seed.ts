import mongoose from 'mongoose';
import User from '../models/User';
import Room from '../models/Room';
import Media from '../models/Media';
import Reservation from '../models/Reservation';
import Amenity from '../models/Amenity';
import EventType from '../models/EventType';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/pilloto_pms';
    await mongoose.connect(mongoURI);
    console.log('✅ Connected to MongoDB');

    // Clear existing data (be careful in production!)
    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Room.deleteMany({});
    await Media.deleteMany({});
    await Reservation.deleteMany({});
    await Amenity.deleteMany({});
    await EventType.deleteMany({});

    // Create admin user
    console.log('👤 Creating admin user...');
    const adminUser = new User({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@pilloto.com',
      password: 'admin123',
      role: 'admin',
      emailVerified: true,
      phone: '+1234567890'
    });
    await adminUser.save();
    console.log('✅ Admin user created:', adminUser.email);

    // Create sample customers
    console.log('👤 Creating sample customers...');
    const customers = [
      {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'customer123',
        role: 'customer',
        emailVerified: true,
        phone: '+1987654321'
      },
      {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        password: 'customer123',
        role: 'customer',
        emailVerified: true,
        phone: '+1555123456'
      },
      {
        firstName: 'Maria',
        lastName: 'Garcia',
        email: 'maria.garcia@example.com',
        password: 'customer123',
        role: 'customer',
        emailVerified: true,
        phone: '+1555987654'
      },
      {
        firstName: 'David',
        lastName: 'Johnson',
        email: 'david.johnson@example.com',
        password: 'customer123',
        role: 'customer',
        emailVerified: true,
        phone: '+1555246810'
      }
    ];

    const savedCustomers = [];
    for (const customerData of customers) {
      const customer = new User(customerData);
      await customer.save();
      savedCustomers.push(customer);
      console.log('✅ Customer created:', customer.email);
    }

    // Create staff user
    console.log('👤 Creating staff user...');
    const staffUser = new User({
      firstName: 'Sarah',
      lastName: 'Wilson',
      email: 'staff@pilloto.com',
      password: 'staff123',
      role: 'staff',
      emailVerified: true,
      phone: '+1234567891'
    });
    await staffUser.save();
    console.log('✅ Staff user created:', staffUser.email);

    // Create sample rooms
    console.log('🏨 Creating sample rooms...');
    const sampleRooms = [
      {
        name: 'Ocean View Standard Room',
        description: 'A comfortable standard room with beautiful ocean views, perfect for couples or solo travelers.',
        capacity: 2,
        price: 120,
        amenities: ['WiFi', 'Air Conditioning', 'Private Bathroom', 'Ocean View'],
        images: ['/images/rooms/standard-ocean.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: false,
          balcony: true,
          oceanView: true,
          kitchenette: false,
          jacuzzi: false
        },
        size: 25,
        bedConfiguration: '1 Queen Bed'
      },
      {
        name: 'Garden View Standard Room',
        description: 'Peaceful standard room with garden views and all essential amenities.',
        capacity: 2,
        price: 100,
        amenities: ['WiFi', 'Air Conditioning', 'Private Bathroom', 'Garden View'],
        images: ['/images/rooms/standard-garden.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: false,
          balcony: true,
          oceanView: false,
          kitchenette: false,
          jacuzzi: false
        },
        size: 23,
        bedConfiguration: '1 Queen Bed'
      },
      {
        name: 'Deluxe Garden Suite',
        description: 'Spacious deluxe room with garden views, mini bar, and premium amenities for a luxurious stay.',
        capacity: 3,
        price: 180,
        amenities: ['WiFi', 'Air Conditioning', 'Mini Bar', 'Garden View', 'Premium Bathroom'],
        images: ['/images/rooms/deluxe-garden.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: true,
          balcony: true,
          oceanView: false,
          kitchenette: false,
          jacuzzi: false
        },
        size: 35,
        bedConfiguration: '1 King Bed + 1 Sofa Bed'
      },
      {
        name: 'Deluxe Ocean Suite',
        description: 'Luxurious deluxe room with stunning ocean views and premium amenities.',
        capacity: 3,
        price: 220,
        amenities: ['WiFi', 'Air Conditioning', 'Mini Bar', 'Ocean View', 'Premium Bathroom'],
        images: ['/images/rooms/deluxe-ocean.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: true,
          balcony: true,
          oceanView: true,
          kitchenette: false,
          jacuzzi: false
        },
        size: 38,
        bedConfiguration: '1 King Bed + 1 Sofa Bed'
      },
      {
        name: 'Premium Ocean Suite',
        description: 'Ultimate luxury with ocean views, jacuzzi, kitchenette, and spacious living area.',
        capacity: 4,
        price: 280,
        amenities: ['WiFi', 'Air Conditioning', 'Mini Bar', 'Ocean View', 'Jacuzzi', 'Kitchenette'],
        images: ['/images/rooms/suite-ocean.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: true,
          balcony: true,
          oceanView: true,
          kitchenette: true,
          jacuzzi: true
        },
        size: 55,
        bedConfiguration: '1 King Bed + 1 Queen Sofa Bed'
      },
      {
        name: 'Penthouse Suite',
        description: 'Top-floor penthouse with panoramic ocean views, private terrace, and luxury amenities.',
        capacity: 4,
        price: 350,
        amenities: ['WiFi', 'Air Conditioning', 'Mini Bar', 'Ocean View', 'Jacuzzi', 'Kitchenette', 'Private Terrace'],
        images: ['/images/rooms/penthouse-suite.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: true,
          balcony: true,
          oceanView: true,
          kitchenette: true,
          jacuzzi: true
        },
        size: 75,
        bedConfiguration: '1 King Bed + 1 Queen Sofa Bed'
      },
      {
        name: 'Family Villa',
        description: 'Perfect for families, featuring multiple bedrooms, full kitchen, and private outdoor space.',
        capacity: 6,
        price: 450,
        amenities: ['WiFi', 'Air Conditioning', 'Full Kitchen', 'Private Pool', 'Multiple Bedrooms'],
        images: ['/images/rooms/villa-family.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: true,
          balcony: true,
          oceanView: true,
          kitchenette: true,
          jacuzzi: true
        },
        size: 120,
        bedConfiguration: '2 King Beds + 2 Twin Beds'
      },
      {
        name: 'Luxury Beach Villa',
        description: 'Exclusive beachfront villa with direct beach access, private pool, and full amenities.',
        capacity: 8,
        price: 650,
        amenities: ['WiFi', 'Air Conditioning', 'Full Kitchen', 'Private Pool', 'Beach Access', 'Multiple Bedrooms'],
        images: ['/images/rooms/villa-beach.jpg'],
        features: {
          wifi: true,
          airConditioning: true,
          miniBar: true,
          balcony: true,
          oceanView: true,
          kitchenette: true,
          jacuzzi: true
        },
        size: 150,
        bedConfiguration: '3 King Beds + 2 Twin Beds'
      }
    ];

    const savedRooms = [];
    for (const roomData of sampleRooms) {
      const room = new Room(roomData);
      await room.save();
      savedRooms.push(room);
      console.log(`✅ Room created: ${room.name}`);
    }

    // Create sample media files
    console.log('📸 Creating sample media files...');
    const sampleMedia = [
      {
        title: 'Resort Main Pool',
        description: 'Beautiful main swimming pool with ocean view',
        url: '/images/gallery/main-pool.jpg',
        type: 'image',
        category: 'aquapark',
        isPublic: true,
        isFeatured: true,
        tags: ['pool', 'swimming', 'aquapark'],
        uploadedBy: adminUser._id,
        fileSize: 2048000
      },
      {
        title: 'Water Slides',
        description: 'Exciting water slides for all ages',
        url: '/images/gallery/water-slides.jpg',
        type: 'image',
        category: 'aquapark',
        isPublic: true,
        isFeatured: true,
        tags: ['slides', 'fun', 'aquapark'],
        uploadedBy: adminUser._id,
        fileSize: 1536000
      },
      {
        title: 'Beachfront Restaurant',
        description: 'Oceanfront dining with spectacular sunset views',
        url: '/images/gallery/restaurant-beach.jpg',
        type: 'image',
        category: 'dining',
        isPublic: true,
        isFeatured: true,
        tags: ['restaurant', 'dining', 'beach', 'sunset'],
        uploadedBy: adminUser._id,
        fileSize: 1792000
      },
      {
        title: 'Spa and Wellness Center',
        description: 'Tranquil spa facility for relaxation and rejuvenation',
        url: '/images/gallery/spa-center.jpg',
        type: 'image',
        category: 'facilities',
        isPublic: true,
        isFeatured: false,
        tags: ['spa', 'wellness', 'relaxation'],
        uploadedBy: adminUser._id,
        fileSize: 1280000
      },
      {
        title: 'Kids Play Area',
        description: 'Safe and fun playground for children',
        url: '/images/gallery/kids-area.jpg',
        type: 'image',
        category: 'activities',
        isPublic: true,
        isFeatured: false,
        tags: ['kids', 'playground', 'family'],
        uploadedBy: adminUser._id,
        fileSize: 1024000
      },
      {
        title: 'Resort Tour Video',
        description: 'Complete virtual tour of Pilloto',
        url: '/videos/resort-tour.mp4',
        type: 'video',
        category: 'general',
        isPublic: true,
        isFeatured: true,
        tags: ['tour', 'overview', 'resort'],
        uploadedBy: adminUser._id,
        fileSize: 25600000
      }
    ];

    for (const mediaData of sampleMedia) {
      const media = new Media(mediaData);
      await media.save();
      console.log(`✅ Media created: ${media.title}`);
    }

    // Create default event types
    console.log('🎉 Creating default event types...');
    const defaultEventTypes = [
      {
        type: 'wedding',
        title: 'Weddings',
        description: 'Create magical moments with our tropical wedding packages',
        features: ['Beachfront ceremony', 'Catering service', 'Photography', 'Decoration', 'Music system'],
        priceFrom: 2500,
        maxGuests: 150,
        maxChildren: 40,
        isActive: true
      },
      {
        type: 'conference',
        title: 'Corporate Events',
        description: 'Professional meetings and conferences in a paradise setting',
        features: ['Conference facilities', 'AV equipment', 'Catering', 'Wi-Fi', 'Parking'],
        priceFrom: 1200,
        maxGuests: 100,
        maxChildren: 20,
        isActive: true
      },
      {
        type: 'birthday',
        title: 'Birthday Parties',
        description: 'Celebrate special birthdays with unforgettable tropical parties',
        features: ['Pool access', 'Decoration', 'Catering', 'Music system', 'Games area'],
        priceFrom: 800,
        maxGuests: 50,
        maxChildren: 30,
        isActive: true
      },
      {
        type: 'corporate',
        title: 'Team Building',
        description: 'Strengthen your team with activities in our beautiful resort',
        features: ['Activity packages', 'Catering', 'Meeting rooms', 'Recreation areas'],
        priceFrom: 1000,
        maxGuests: 80,
        maxChildren: 20,
        isActive: true
      },
      {
        type: 'other',
        title: 'Custom Events',
        description: 'Let us help you create your perfect custom celebration',
        features: ['Flexible packages', 'Custom catering', 'Personalized service', 'All amenities'],
        priceFrom: 600,
        maxGuests: 200,
        maxChildren: 100,
        isActive: true
      }
    ];

    for (const et of defaultEventTypes) {
      const created = new EventType(et);
      await created.save();
      console.log(`✅ Event type created: ${created.title}`);
    }

    // Create sample amenities
    console.log('🏖️ Creating sample amenities...');
    const sampleAmenities = [
      {
        name: 'WiFi Internet Access',
        description: 'High-speed wireless internet available throughout the resort, including all rooms and common areas.',
        image: '/uploads/amenity-1756102842080-72004708.png',
        category: 'general',
        order: 1,
        isActive: true
      },
      {
        name: 'Swimming Pool & Water Park',
        description: 'Multiple swimming pools including an exciting water park with slides, lazy river, and kids play area.',
        image: '/uploads/amenity-1756103966927-89796559.png',
        category: 'recreation',
        order: 2,
        isActive: true
      },
      {
        name: 'Beachfront Restaurant',
        description: 'Oceanfront dining experience with fresh seafood, local cuisine, and international dishes.',
        image: '/uploads/amenity-1756104332479-390453734.png',
        category: 'dining',
        order: 3,
        isActive: true
      },
      {
        name: 'Spa & Wellness Center',
        description: 'Full-service spa offering massages, beauty treatments, and wellness therapies for ultimate relaxation.',
        image: '/uploads/amenity-1756107324572-360979240.png',
        category: 'wellness',
        order: 4,
        isActive: true
      },
      {
        name: 'Air Conditioning',
        description: 'Climate-controlled comfort in all rooms and common areas to ensure your perfect temperature.',
        image: '/uploads/amenity-1756107533015-353658500.png',
        category: 'accommodation',
        order: 5,
        isActive: true
      },
      {
        name: 'Private Beach Access',
        description: 'Direct access to pristine white sand beaches with crystal clear waters and beach chair service.',
        image: '/uploads/amenity-1756225409793-983811573.png',
        category: 'recreation',
        order: 6,
        isActive: true
      },
      {
        name: 'Kids Play Area',
        description: 'Safe and supervised playground with age-appropriate activities and entertainment for children.',
        image: '/images/amenities/kids-area.jpg',
        category: 'recreation',
        order: 7,
        isActive: true
      },
      {
        name: '24/7 Room Service',
        description: 'Round-the-clock room service menu available for in-room dining convenience.',
        image: '/images/amenities/room-service.jpg',
        category: 'accommodation',
        order: 8,
        isActive: true
      },
      {
        name: 'Airport Transfer Service',
        description: 'Convenient transportation service to and from the airport with comfortable vehicles.',
        image: '/images/amenities/transfer.jpg',
        category: 'general',
        order: 9,
        isActive: true
      },
      {
        name: 'Fitness Center',
        description: 'Modern gym facility with cardio equipment, weights, and fitness classes.',
        image: '/images/amenities/gym.jpg',
        category: 'wellness',
        order: 10,
        isActive: true
      },
      {
        name: 'Business Center',
        description: 'Fully equipped business center with computers, printers, and meeting facilities.',
        image: '/images/amenities/business.jpg',
        category: 'business',
        order: 11,
        isActive: true
      },
      {
        name: 'Poolside Bar',
        description: 'Refreshing drinks and light snacks served at our poolside bar with tropical atmosphere.',
        image: '/images/amenities/pool-bar.jpg',
        category: 'dining',
        order: 12,
        isActive: true
      }
    ];

    for (const amenityData of sampleAmenities) {
      const amenity = new Amenity(amenityData);
      await amenity.save();
      console.log(`✅ Amenity created: ${amenity.name}`);
    }

    // Create sample reservations (roomType removed)
    console.log('🏨 Creating sample reservations...');
    const sampleReservations = [
      {
        type: 'room',
        user: savedCustomers[0]._id,
        room: savedRooms[2]._id, // Deluxe Garden Suite
        checkInDate: new Date('2025-09-15'),
        checkOutDate: new Date('2025-09-20'),
        guests: 3,
        totalPrice: 1000, // 5 nights × $200 (deluxe rate)
        totalNights: 5,
        status: 'confirmed',
        paymentMethod: 'card',
        assignedBy: adminUser._id,
        assignedAt: new Date(),
        guestDetails: {
          adults: 2,
          children: 1,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[0].phone,
          email: savedCustomers[0].email
        },
        services: {
          breakfast: true,
          airportTransfer: false,
          spa: true,
          aquaPark: true
        },
        specialRequests: 'Late check-in expected around 8 PM'
      },
      {
        type: 'room',
        user: savedCustomers[1]._id,
        room: savedRooms[6]._id, // Family Villa
        checkInDate: new Date('2025-10-01'),
        checkOutDate: new Date('2025-10-07'),
        guests: 5,
        totalPrice: 3000, // 6 nights × $500 (villa rate)
        totalNights: 6,
        status: 'confirmed',
        paymentMethod: 'card',
        assignedBy: adminUser._id,
        assignedAt: new Date(),
        guestDetails: {
          adults: 2,
          children: 3,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[1].phone,
          email: savedCustomers[1].email
        },
        services: {
          breakfast: true,
          airportTransfer: true,
          spa: false,
          aquaPark: true
        },
        specialRequests: 'Need crib for youngest child'
      },
      {
        type: 'room',
        user: savedCustomers[2]._id,
        room: savedRooms[0]._id, // Ocean View Standard Room
        checkInDate: new Date('2025-08-28'),
        checkOutDate: new Date('2025-08-30'),
        guests: 2,
        totalPrice: 300, // 2 nights × $150 (standard rate)
        totalNights: 2,
        status: 'completed',
        paymentMethod: 'card',
        assignedBy: adminUser._id,
        assignedAt: new Date(),
        guestDetails: {
          adults: 2,
          children: 0,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[2].phone,
          email: savedCustomers[2].email
        },
        services: {
          breakfast: false,
          airportTransfer: false,
          spa: true,
          aquaPark: false
        }
      },
      {
        type: 'room',
        user: savedCustomers[3]._id,
        checkInDate: new Date('2025-11-10'),
        checkOutDate: new Date('2025-11-15'),
        guests: 2,
        totalPrice: 1500, // 5 nights × $300 (suite rate)
        totalNights: 5,
        status: 'pending',
        guestDetails: {
          adults: 2,
          children: 0,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[3].phone,
          email: savedCustomers[3].email
        },
        services: {
          breakfast: true,
          airportTransfer: true,
          spa: true,
          aquaPark: true
        },
        specialRequests: 'Honeymoon package requested - Room assignment pending'
      },
      // Add a few more general reservations without assigned rooms
      {
        type: 'room',
        user: savedCustomers[0]._id,
        checkInDate: new Date('2025-12-15'),
        checkOutDate: new Date('2025-12-18'),
        guests: 2,
        totalPrice: 450, // 3 nights × $150
        totalNights: 3,
        status: 'pending',
        paymentMethod: 'card',
        guestDetails: {
          adults: 2,
          children: 0,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[0].phone,
          email: savedCustomers[0].email
        },
        services: {
          breakfast: false,
          airportTransfer: true,
          spa: false,
          aquaPark: true
        },
        specialRequests: 'Anniversary celebration - requesting ocean view if available'
      },
      {
        type: 'room',
        user: savedCustomers[1]._id,
        checkInDate: new Date('2025-12-20'),
        checkOutDate: new Date('2025-12-25'),
        guests: 4,
        totalPrice: 1000, // 5 nights × $200
        totalNights: 5,
        status: 'pending',
        guestDetails: {
          adults: 2,
          children: 2,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[1].phone,
          email: savedCustomers[1].email
        },
        services: {
          breakfast: true,
          airportTransfer: false,
          spa: false,
          aquaPark: true
        },
        specialRequests: 'Christmas holiday stay - room assignment needed'
      }
    ];

    for (const reservationData of sampleReservations) {
      const reservation = new Reservation(reservationData);
      await reservation.save();
      console.log(`✅ Reservation created for user: ${reservation.user}`);
    }

    // Create sample day pass reservations (now using unified Reservation model)
    console.log('🎫 Creating sample day pass reservations...');
    const sampleDayPassReservations = [
      {
        type: 'daypass',
        user: savedCustomers[0]._id,
        checkInDate: new Date('2025-09-25'),
        guests: 3,
        totalPrice: 100, // Updated pricing: 2 adults × $30 + 1 child × $20 + aqua park access
        totalDays: 1,
        status: 'confirmed',
        paymentMethod: 'card',
        guestDetails: {
          adults: 2,
          children: 1,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[0].phone,
          email: savedCustomers[0].email,
          country: 'US'
        },
        services: {
          breakfast: false,
          spa: false,
          aquaPark: true
        },
        specialRequests: 'First time visiting, looking forward to the water slides!'
      },
      {
        type: 'daypass',
        user: savedCustomers[1]._id,
        checkInDate: new Date('2025-09-30'),
        guests: 7,
        totalPrice: 180, // 4 adults × $30 + 2 children × $20 + aqua park access
        totalDays: 1,
        status: 'confirmed',
        paymentMethod: 'card',
        guestDetails: {
          adults: 4,
          children: 2,
          infants: 1
        },
        contactInfo: {
          phone: savedCustomers[1].phone,
          email: savedCustomers[1].email,
          country: 'CA'
        },
        services: {
          breakfast: true,
          spa: false,
          aquaPark: true
        },
        specialRequests: 'Birthday party for 6-year-old, need high chair for infant'
      },
      {
        type: 'daypass',
        user: savedCustomers[2]._id,
        checkInDate: new Date('2025-10-05'),
        guests: 2,
        totalPrice: 60, // 2 adults × $30
        totalDays: 1,
        status: 'confirmed',
        paymentMethod: 'card',
        guestDetails: {
          adults: 2,
          children: 0,
          infants: 0
        },
        contactInfo: {
          phone: savedCustomers[2].phone,
          email: savedCustomers[2].email,
          country: 'MX'
        },
        services: {
          breakfast: false,
          spa: true,
          aquaPark: false
        }
      }
    ];

    for (const dayPassData of sampleDayPassReservations) {
      const dayPassReservation = new Reservation(dayPassData);
      await dayPassReservation.save();
      console.log(`✅ Day pass reservation created for user: ${dayPassReservation.user}`);
    }

    console.log('\n🎉 Database seeded successfully!');
    console.log('\n📋 Created accounts:');
    console.log('Admin: admin@pilloto.com / admin123');
    console.log('Staff: staff@pilloto.com / staff123');
    console.log('Customers:');
    console.log('  - john.doe@example.com / customer123');
    console.log('  - jane.smith@example.com / customer123');
    console.log('  - maria.garcia@example.com / customer123');
    console.log('  - david.johnson@example.com / customer123');

    console.log(`\n🏨 Created ${sampleRooms.length} sample rooms`);
    console.log(`📸 Created ${sampleMedia.length} sample media files`);
    console.log(`🏖️ Created ${sampleAmenities.length} sample amenities`);
    console.log(`🛏️  Created ${sampleReservations.length} sample reservations (includes general bookings)`);
    console.log(`🎫 Created ${sampleDayPassReservations.length} sample day pass reservations`);

  } catch (error) {
    console.error('❌ Error seeding database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the seed function
seedDatabase();
