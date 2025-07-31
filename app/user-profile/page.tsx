'use client'
import { useState, useEffect } from 'react'
import { useAuth, useUser, useReverification } from '@clerk/nextjs'
import { EmailAddressResource } from '@clerk/types'

export default function Page() {
  // Use `useAuth()` to access the authentication context,
  // including the user's session claims
  const { isLoaded: authLoaded, userId, sessionClaims } = useAuth()

  // Use `useUser()` to access the user object for email operations
  const { isLoaded: userLoaded, isSignedIn, user } = useUser()

  // Birthday state
  const [birthday, setBirthday] = useState('')
  const [birthdayStatus, setBirthdayStatus] = useState<'loading' | 'success' | 'error' | null>(null)
  const [birthdayError, setBirthdayError] = useState<string | null>(null)

  // Email state
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [emailSuccessful, setEmailSuccessful] = useState(false)
  const [emailObj, setEmailObj] = useState<EmailAddressResource | undefined>()
  const [emailError, setEmailError] = useState<string | null>(null)

  const createEmailAddress = useReverification((email: string) => user?.createEmailAddress({ email }))

  // Update birthday state once the user's data loads
  useEffect(() => {
    // Retrieve the user's birthday from the session token's claims under the `birthday` key
    setBirthday(sessionClaims?.birthday || '')
  }, [sessionClaims])

  // Birthday update function
  async function updateUserBirthday(birthday: string) {
    try {
      const response = await fetch('/api/update-user-metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ birthday }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update birthday')
      }

      return { success: true }
    } catch (err: any) {
      return { error: err.message || 'Failed to update birthday' }
    }
  }

  const handleBirthdaySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBirthdayStatus('loading')
    setBirthdayError(null)

    // Check if the birthday has been modified
    if (birthday === (sessionClaims?.birthday || '')) {
      setBirthdayError('Please enter a new birthday to update')
      setBirthdayStatus('error')
      return
    }

    try {
      const result = await updateUserBirthday(birthday)

      if (result.error) {
        setBirthdayError(result.error)
        setBirthdayStatus('error')
      } else {
        setBirthdayStatus('success')
      }
    } catch (err: any) {
      setBirthdayError(err.message || 'Failed to update birthday')
      setBirthdayStatus('error')
    }
  }

  // Email addition function
  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailError(null)

    try {
      // Add an unverified email address to user
      const res = await createEmailAddress(email)
      // Reload user to get updated User object
      await user.reload()

      // Find the email address that was just added
      const emailAddress = user.emailAddresses.find((a) => a.id === res?.id)
      // Create a reference to the email address that was just added
      setEmailObj(emailAddress)

      // Send the user an email with the verification code
      emailAddress?.prepareVerification({ strategy: 'email_code' })

      // Set to true to display second form
      // and capture the OTP code
      setIsVerifying(true)
    } catch (err: any) {
      setEmailError(err.message || 'Failed to add email address')
      console.error(JSON.stringify(err, null, 2))
    }
  }

  // Handle the submission of the verification form
  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailError(null)

    try {
      // Verify that the code entered matches the code sent to the user
      const emailVerifyAttempt = await emailObj?.attemptVerification({ code })

      if (emailVerifyAttempt?.verification.status === 'verified') {
        setEmailSuccessful(true)
        setIsVerifying(false)
        setCode('')
        setEmail('')
      } else {
        // If the status is not complete, check why. User may need to
        // complete further steps.
        setEmailError('Verification failed. Please try again.')
        console.error(JSON.stringify(emailVerifyAttempt, null, 2))
      }
    } catch (err: any) {
      setEmailError(err.message || 'Verification failed')
      console.error(JSON.stringify(err, null, 2))
    }
  }

  // Check if Clerk has loaded
  if (!authLoaded || !userLoaded) return <div>Loading...</div>

  // Check if the user is authenticated
  if (!userId || !isSignedIn) return <div>Sign in to view your profile</div>

  return (
    <div style={{ maxWidth: 800, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>User Profile</h1>

      {/* Birthday Section */}
      <div style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Update Your Birthday</h2>
        <form onSubmit={handleBirthdaySubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="birthday">Birthday (YYYY-MM-DD):</label>
            <input
              id="birthday"
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              style={{ marginLeft: '0.5rem' }}
            />
          </div>
          <button type="submit" disabled={birthdayStatus === 'loading'}>
            {birthdayStatus === 'loading' ? 'Updating...' : 'Update Birthday'}
          </button>
        </form>
        {birthdayStatus === 'success' && <p style={{ color: 'green' }}>Birthday updated successfully!</p>}
        {birthdayStatus === 'error' && <p style={{ color: 'red' }}>{birthdayError}</p>}
      </div>

      {/* Email Section */}
      <div style={{ padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h2>Add Email Address</h2>

        {/* Display current email addresses */}
        <div style={{ marginBottom: '1rem' }}>
          <h3>Current Email Addresses:</h3>
          <ul>
            {user.emailAddresses.map((emailAddr) => (
              <li key={emailAddr.id}>
                {emailAddr.emailAddress}
                {emailAddr.verification?.status === 'verified' ? ' (Verified)' : ' (Unverified)'}
              </li>
            ))}
          </ul>
        </div>

        {/* Display a success message if the email was added successfully */}
        {emailSuccessful && (
          <div style={{ color: 'green', marginBottom: '1rem' }}>
            <p>Email added successfully!</p>
          </div>
        )}

        {/* Display the verification form to capture the OTP code */}
        {isVerifying && (
          <div style={{ marginBottom: '1rem' }}>
            <h3>Verify email</h3>
            <form onSubmit={verifyCode}>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="code">Enter verification code:</label>
                <input
                  onChange={(e) => setCode(e.target.value)}
                  id="code"
                  name="code"
                  type="text"
                  value={code}
                  style={{ marginLeft: '0.5rem' }}
                />
              </div>
              <button type="submit">Verify</button>
            </form>
          </div>
        )}

        {/* Display the initial form to capture the email address */}
        {!isVerifying && (
          <form onSubmit={handleEmailSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label htmlFor="email">Enter email address:</label>
              <input
                onChange={(e) => setEmail(e.target.value)}
                id="email"
                name="email"
                type="email"
                value={email}
                style={{ marginLeft: '0.5rem' }}
              />
            </div>
            <button type="submit">Add Email</button>
          </form>
        )}

        {emailError && <p style={{ color: 'red' }}>{emailError}</p>}
      </div>
    </div>
  )
}
