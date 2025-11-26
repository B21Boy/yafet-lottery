import { db, collection, addDoc } from './firebase-init.js';

// Include Cloudinary widget in HTML
// <script src="https://widget.cloudinary.com/v2.0/global/all.js" type="text/javascript"></script>

// Initialize Cloudinary widget
const myWidget = cloudinary.createUploadWidget({
cloudName: 'dwfz6c6x0',       // replace with your Cloudinary cloud name
uploadPreset: 'deksi-image'     // or signed upload if you have a server-side signature
}, async (error, result) => {
if (!error && result && result.event === "success") {
console.log('Uploaded image info:', result.info);

```
// Store image URL and metadata in Firestore
try {
  const docRef = await addDoc(collection(db, "images"), {
    url: result.info.secure_url,
    publicId: result.info.public_id,
    uploadedAt: new Date()
  });
  console.log("Document written with ID: ", docRef.id);
} catch (err) {
  console.error("Error saving document: ", err);
}
```

}
});

// Attach widget to button
document.getElementById("uploadBtn").addEventListener("click", () => {
myWidget.open();
});
