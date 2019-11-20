const fs = require('fs');
const express = require('express');
const multer = require('multer');
const Music = require('../models/music');
const { uploadCover } = require('../s3/s3_post');
const managedUpload = require('../s3/managed_upload/managedUpload');
const deleteTrack = require('../s3/s3_delete');

const storage = multer.diskStorage({
  destination: './tmp/tracks',
  filename: (req, file, cb) => {
    cb(null, file.originalname.replace(/ /g, '_').toLowerCase());
  },
});

const upload = multer({ storage });

const router = new express.Router();

// Grab all tracks
router.get('/music', async (req, res) => {
  const music = await Music.find({});
  res.send(music);
});

// Search for a track, returns one result
router.get('/music/search', async (req, res) => {
  if (!req.query) {
    res.status(404).send({
      error: 'Track not found.',
    });
  }
  try {
    const searchTerm = req.query.term;
    const matchingTracks = await Music.find({
      $text: {
        $search: searchTerm,
        $caseSensitive: false,
        $diacriticSensitive: false,
      },
    });
    console.log(matchingTracks);
    res.status(201).send(matchingTracks);
  } catch (e) {
    res.status(500).send(e);
  }
});

// Upload a single master track with cover art
router.post('/music/upload', upload.fields([{ name: 'track', maxCount: 1 }, { name: 'cover', maxCount: 1 }, { name: 'trackout', maxCount: 1 }]), async (req, res) => {
  console.log('Upload started');
  const { genre, isPublic } = req.body;
  const presentationTitle = req.body.trackTitle;
  const trackTitle = req.body.trackTitle.replace(/ /g, '_').toLowerCase();
  const mood = req.body.mood.split(',');
  const similarArtists = req.body.similarArtists.split(',');
  const price = Number(req.body.price) - 0.01;
  const bpm = Number(req.body.bpm);
  let trackoutUrl;
  let trackUrl;

  try {
    trackoutUrl = await managedUpload(req.files.trackout[0].path, trackTitle, 'trackout', 'application/zip', 'zip');
    trackUrl = await managedUpload(req.files.track[0].path, trackTitle, 'master', 'audio/wav', 'wav');
    const imageUrl = await uploadCover(req.files.cover[0].path, trackTitle);
    const music = new Music({
      trackTitle,
      presentationTitle,
      genre,
      isPublic,
      mood,
      similarArtists,
      price,
      bpm,
      trackUrl,
      imageUrl,
      trackoutUrl,
    });
    await music.save();
    console.log('success');
    fs.unlinkSync(req.files.trackout[0].path);
    fs.unlinkSync(req.files.track[0].path);
    fs.unlinkSync(req.files.cover[0].path);
    return res.status(201).send({
      status: 'success',
      message: 'Your track was uploaded successfully.',
    });
  } catch (e) {
    console.log(e);
    return res.send({
      status: 'error',
      message: 'Sorry, we were unable to upload your track.',
      error: e,
    });
  }
});

// Update a track
router.patch('/music/', async (req, res) => {
  const updates = Object.keys(req.body);
  console.log(req.query.trackTitle);
  const allowedUpdates = ['mood', 'isPublic', 'price', 'trackTitle', 'presentationTitle', 'genre', 'bpm', 'similarArtists'];
  const isValidOperation = updates.every((update) => allowedUpdates.includes(update));

  if (!isValidOperation) {
    return res.status(400).send({ error: 'Invalid updates' });
  }

  try {
    const track = await Music.findOne({ trackTitle: decodeURIComponent(req.query.trackTitle) });

    if (!track) {
      console.log('not found');
      return res.status(404).send({
        status: 'error',
        message: 'Sorry, we were unable to update your track.',
        error: '',
      });
    }

    updates.forEach((update) => {
      console.log(update);
      if (update === 'trackTitle') {
        track[update] = req.body[update].replace(/ /g, '_').toLowerCase();
        track.presentationTitle = req.body[update];
        return;
      }
      track[update] = req.body[update];
    });

    await track.save();

    return res.send(
      {
        status: 'success',
        message: 'Your track has been updated.',
        track,
      },
    );
  } catch (e) {
    return res.status(400).send({
      status: 'error',
      message: 'Sorry, we were unable to upload your track',
      error: e,
    });
  }
});

// Delete a track
router.delete('/music/', async (req, res) => {
  try {
    const track = await Music.findOneAndDelete({ trackTitle: req.query.trackTitle });

    if (!track) {
      return res.status(404).send();
    }
    await deleteTrack(req.query.trackTitle);
    return res.send(track);
  } catch (e) {
    return res.status(400).send(e);
  }
});

module.exports = router;
