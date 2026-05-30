/* === Logo Story Intro: START === */

document.addEventListener('DOMContentLoaded', () => {
  const section = document.getElementById('logo-story-intro');
  const video = document.getElementById('logo-story-video');
  const fallbackOverlay = document.getElementById('logo-intro-fallback');
  const playBtn = document.getElementById('logo-intro-play-btn');
  const scrollCue = document.getElementById('logo-intro-scroll-cue');
  let hasPlayed = false;

  if (!video || !section) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    section.classList.remove('opacity-0'); // Show immediately without fade
    scrollCue.classList.add('is-visible');
    document.body.classList.add('logo-intro-complete');
    return; // Do not attempt autoplay
  }

  // Handle Autoplay & Fallback
  const attemptAutoplay = async () => {
    try {
      await video.play();
      fallbackOverlay.classList.remove('is-visible');
      fallbackOverlay.classList.add('pointer-events-none');
    } catch (err) {
      // Autoplay blocked
      fallbackOverlay.classList.add('is-visible');
      fallbackOverlay.classList.remove('pointer-events-none');
      
      // Show scroll cue after 3 seconds if not played
      setTimeout(() => {
        if (!hasPlayed) {
          scrollCue.classList.add('is-visible');
        }
      }, 3000);
    }
  };

  // Intersection Observer for playing only in view
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        section.classList.remove('opacity-0'); // Fade in smoothly
        if (!hasPlayed) {
          attemptAutoplay();
        }
      } else {
        if(!hasPlayed && !video.paused) {
           video.pause();
        }
      }
    });
  }, { threshold: 0.3 });

  observer.observe(section);

  // Manual Play fallback
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      video.muted = true; // explicitly keeping it muted to align with standard identifiers
      video.play().then(() => {
        fallbackOverlay.classList.remove('is-visible');
        fallbackOverlay.classList.add('pointer-events-none');
        scrollCue.classList.remove('is-visible');
      }).catch(console.error);
    });
  }

  // End event handles freezing last frame (naturally occurs) and scroll cue
  video.addEventListener('ended', () => {
    hasPlayed = true;
    document.body.classList.add('logo-intro-complete');
    scrollCue.classList.add('is-visible');
  });
});

/* === Logo Story Intro: END === */
