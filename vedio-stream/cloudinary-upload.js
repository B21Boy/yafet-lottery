// Helper to upload a Blob (video) to Cloudinary and return the secure_url
export async function uploadVideoToCloudinary(blob) {
  const url = 'https://api.cloudinary.com/v1_1/dwfz6c6x0/video/upload';
  const preset = 'deksi-image'; // Use your unsigned upload preset
  const formData = new FormData();
  formData.append('file', blob);
  formData.append('upload_preset', preset);
  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error('Cloudinary upload failed');
  const data = await resp.json();
  if (!data.secure_url) throw new Error('No secure_url from Cloudinary');
  return data.secure_url;
}
