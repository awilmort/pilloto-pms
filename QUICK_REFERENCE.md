# Quick Reference - Guest Booking System

## Making a Guest Reservation (No Login Required)

### API Endpoint

```
POST /api/reservations
Content-Type: application/json
```

### Required Fields for Guest Booking

```json
{
  "type": "room|daypass|event",
  "guestName": {
    "firstName": "John",
    "lastName": "Doe"
  },
  "contactInfo": {
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "checkInDate": "2025-12-25",
  "guestDetails": {
    "adults": 2,
    "children": 0,
    "infants": 0
  }
}
```

### Response

```json
{
  "success": true,
  "message": "Reservation created successfully. A confirmation email has been sent.",
  "data": {
    "_id": "reservation_id",
    "confirmationToken": "1734567890-abc123xyz",
    "guestName": {
      "firstName": "John",
      "lastName": "Doe"
    },
    "contactInfo": {
      "email": "john@example.com",
      "phone": "+1234567890"
    }
    // ... rest of reservation data
  }
}
```

## Accessing Guest Reservation

### View Reservation (Public)

```
GET /api/reservations/public/:confirmationToken
```

### Cancel Reservation (Public)

```
PUT /api/reservations/public/:confirmationToken/cancel
Content-Type: application/json

{
  "cancellationReason": "Plans changed"  // Optional
}
```

## Frontend Routes

### Public Reservation Page

```
/reservation/:confirmationToken
```

Example: `https://pilloto.com/reservation/1734567890-abc123xyz`

## Email Notification

### Automatically Sent After Booking

- Reservation summary
- Guest details
- Pricing breakdown
- **View reservation link**: `/reservation/{confirmationToken}`
- **Cancel reservation link**: Same page with cancel button

## Key Differences: Guest vs User Booking

| Feature            | Guest Booking             | User Booking                |
| ------------------ | ------------------------- | --------------------------- |
| Authentication     | Not required              | Optional                    |
| Name Field         | Required (guestName)      | From user account           |
| Confirmation Token | Generated                 | Generated                   |
| Email Notification | Sent to contactInfo.email | Sent to user.email          |
| Access Method      | Confirmation token link   | Token link OR /reservations |
| Cancellation       | Public endpoint           | Authenticated endpoint      |

## Code Examples

### Frontend: Creating Guest Booking

```typescript
const createGuestBooking = async (bookingData: any) => {
  const response = await fetch("http://localhost:5001/api/reservations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // No Authorization header needed!
    },
    body: JSON.stringify({
      type: "daypass",
      guestName: {
        firstName: bookingData.firstName,
        lastName: bookingData.lastName,
      },
      contactInfo: {
        email: bookingData.email,
        phone: bookingData.phone,
      },
      checkInDate: bookingData.visitDate.toISOString(),
      guestDetails: {
        adults: bookingData.adults,
        children: bookingData.children,
        infants: bookingData.infants,
      },
      services: bookingData.services,
      guests: bookingData.adults + bookingData.children + bookingData.infants,
    }),
  });

  return await response.json();
};
```

### Frontend: Viewing Guest Reservation

```typescript
const viewGuestReservation = async (confirmationToken: string) => {
  const response =
    await reservationsService.getPublicReservation(confirmationToken);
  return response.data.data; // Reservation object
};
```

### Frontend: Canceling Guest Reservation

```typescript
const cancelGuestReservation = async (
  confirmationToken: string,
  reason?: string,
) => {
  const response = await reservationsService.cancelPublicReservation(
    confirmationToken,
    reason,
  );
  return response.data;
};
```

## Form Validation

### Required Fields (Guest Booking)

- ✅ First Name (non-empty string)
- ✅ Last Name (non-empty string)
- ✅ Email (valid email format)
- ✅ Phone (valid phone number)
- ✅ Check-in Date (future date)
- ✅ At least 1 adult

### Optional Fields

- ✅ Children count
- ✅ Infants count
- ✅ Special requests
- ✅ Additional services
- ✅ Country

## Common Issues & Solutions

### Issue: "First name and last name are required"

**Cause**: Missing `guestName` in request  
**Solution**: Include `guestName.firstName` and `guestName.lastName`

### Issue: "Email and phone number are required"

**Cause**: Missing contact information  
**Solution**: Include `contactInfo.email` and `contactInfo.phone`

### Issue: "Reservation not found"

**Cause**: Invalid confirmation token  
**Solution**: Verify token from email link

### Issue: Email not received

**Cause**: Email service not configured  
**Solution**: Check `EMAIL_FROM` and `EMAIL_PASSWORD` in `.env`

## Testing Commands

### Create Guest Booking

```bash
curl -X POST http://localhost:5001/api/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "type": "daypass",
    "guestName": {"firstName": "Test", "lastName": "User"},
    "contactInfo": {"email": "test@example.com", "phone": "+1234567890"},
    "checkInDate": "2025-12-25",
    "guestDetails": {"adults": 2, "children": 0, "infants": 0},
    "guests": 2
  }'
```

### View Guest Reservation

```bash
curl http://localhost:5001/api/reservations/public/YOUR_TOKEN_HERE
```

### Cancel Guest Reservation

```bash
curl -X PUT http://localhost:5001/api/reservations/public/YOUR_TOKEN_HERE/cancel \
  -H "Content-Type: application/json" \
  -d '{"cancellationReason": "Test cancellation"}'
```

## Database Query Examples

### Find guest reservations

```javascript
db.reservations.find({
  user: null,
  guestName: { $exists: true },
});
```

### Find reservation by confirmation token

```javascript
db.reservations.findOne({
  confirmationToken: "1734567890-abc123xyz",
});
```

### Find reservations by guest email

```javascript
db.reservations.find({
  "contactInfo.email": "john@example.com",
});
```

## Environment Setup

### Backend (.env)

```env
PORT=5001
MONGODB_URI=mongodb://localhost:27017/pilloto_pms
JWT_SECRET=your_jwt_secret
FRONTEND_URL=http://localhost:3000

# Email Configuration
EMAIL_FROM=noreply@pilloto.com
EMAIL_PASSWORD=your_email_password
NODE_ENV=development
```

### Frontend (package.json proxy)

```json
{
  "proxy": "http://localhost:5001"
}
```

## Quick Start

1. **Start Backend**

   ```bash
   cd backend
   npm run build
   npm start
   ```

2. **Start Frontend**

   ```bash
   cd frontend
   npm start
   ```

3. **Test Guest Booking**
   - Navigate to `http://localhost:3000/daypass`
   - Fill form WITHOUT logging in
   - Submit booking
   - Check email for confirmation link
   - Click link to view reservation

## Important Notes

⚠️ **Confirmation tokens are unique** - Each reservation gets a unique token  
⚠️ **24-hour cancellation policy** - Must cancel 24+ hours before check-in  
⚠️ **Email required** - All bookings must have valid email  
⚠️ **Phone required** - All bookings must have valid phone number  
⚠️ **Guest name stored separately** - Not linked to user accounts

✅ **No registration barrier** - Increased conversion rate  
✅ **Email automatically captured** - For marketing and communication  
✅ **Self-service cancellation** - Guests can cancel themselves  
✅ **Professional emails** - Branded confirmation emails sent automatically

---

**Last Updated**: December 21, 2025  
**Version**: 2.0.0

---

## Room Availability Logic

### Endpoints

- `GET /api/rooms/available?start=YYYY-MM-DD&end=YYYY-MM-DD`
  - Returns all **active** rooms available in the given date range.
  - Date range is treated as `[start, end)` — the checkout day is excluded from occupancy.

- `GET /api/rooms/:id/availability?date=YYYY-MM-DD`
  - Returns availability for a single room on a specific local day.

### Overlap Rule

A room is considered **unavailable** for a date window `[start, end)` if there exists any reservation where:

```
reservation.checkInDate < end AND reservation.checkOutDate > start
```

This excludes the checkout day from occupancy (guest leaves on checkout).

### Timezone Handling

- Use local calendar dates (`YYYY-MM-DD`) to avoid timezone drift.
- Frontend normalizes comparisons with `dayjs(date).startOf('day')`.

### Examples

- Query available rooms for New Year's Eve:

```bash
curl \
  "http://localhost:5001/api/rooms/available?start=2025-12-31&end=2026-01-01"
```

- Check if room `abc123` is occupied on Dec 30, 2025:

```bash
curl \
  "http://localhost:5001/api/rooms/abc123/availability?date=2025-12-30"
```

### UI Notes

- Admin Accommodations shows per-day reservation status:
  - **Arriving**: selected date equals check-in day
  - **Departing**: selected date equals check-out day
  - **In Progress**: selected date strictly between check-in and check-out
