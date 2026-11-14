import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import { exerciseImageUrl } from '../lib/exerciseLibrary';

interface Props {
  gifUrl?: string;
  /** free-exercise-db relative paths — frames are cycled to animate. */
  images?: string[];
  size?: number | string;
  rounded?: number;
  /** Set false to show only the first frame (e.g. list thumbnails). */
  animate?: boolean;
  alt?: string;
}

/**
 * Animated exercise demo. Prefers a real GIF url; otherwise cycles the
 * two library photo frames every 900ms, which reads like a GIF.
 */
export default function ExerciseGif(props: Props) {
  // A new source gets fresh failure/frame state, including after a broken custom GIF.
  const source = JSON.stringify([props.gifUrl ?? null, props.images ?? []]);
  return <ExerciseGifSource key={source} {...props} />;
}

function ExerciseGifSource({ gifUrl, images, size = 72, rounded = 2, animate = true, alt = 'exercise demo' }: Props) {
  const [frame, setFrame] = useState(0);
  const [failed, setFailed] = useState(false);

  const frames = images ?? [];
  const shouldCycle = !gifUrl && animate && frames.length > 1 && !failed;

  useEffect(() => {
    if (!shouldCycle) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 900);
    return () => clearInterval(id);
  }, [shouldCycle, frames.length]);

  const src = gifUrl ?? (frames.length ? exerciseImageUrl(frames[frame % frames.length]) : null);

  if (!src || failed) {
    return (
      <Box
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={!alt || undefined}
        sx={{
          width: size,
          height: size,
          borderRadius: rounded,
          bgcolor: 'grey.100',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'grey.400',
          flexShrink: 0,
        }}
      >
        <FitnessCenterIcon />
      </Box>
    );
  }

  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      sx={{
        width: size,
        height: size,
        borderRadius: rounded,
        objectFit: 'cover',
        bgcolor: 'grey.100',
        flexShrink: 0,
      }}
    />
  );
}
