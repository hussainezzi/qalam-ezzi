import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

/* ---------- preloader ---------- */
const preloader = document.getElementById("preloader");
const loadBar = document.getElementById("loadBar");
const skipPreload = new URLSearchParams(location.search).has("no-preload");
let p = 0;

if (skipPreload) {
  preloader.classList.add("is-done");
  document.body.classList.remove("locked");
} else {
  document.body.classList.add("locked");
  const tick = setInterval(() => {
    p = Math.min(100, p + 22 + Math.random() * 20);
    loadBar.style.width = p + "%";
    if (p >= 100) {
      clearInterval(tick);
      setTimeout(() => {
        preloader.classList.add("is-done");
        document.body.classList.remove("locked");
      }, 250);
    }
  }, 90);
}

/* ---------- three.js ink field ---------- */
const canvas = document.getElementById("ink");
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer, scene, camera, points, geo, base, clock, raf;
const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

function initThree() {
  if (reduce) return;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 6.4);

  const cols = 90, rows = 46, count = cols * rows;
  geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  base = new Float32Array(count * 3);

  const c1 = new THREE.Color("#c9a227");
  const c2 = new THREE.Color("#f3e3b6");
  const c3 = new THREE.Color("#7a5c17");

  let i = 0;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const px = (x / (cols - 1) - 0.5) * 15;
      const py = (y / (rows - 1) - 0.5) * 8.4;
      const pz = 0;
      base[i * 3] = px; base[i * 3 + 1] = py; base[i * 3 + 2] = pz;
      pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;

      const t = (px + 7.5) / 15;
      const c = c3.clone().lerp(c1, Math.min(1, t * 1.5)).lerp(c2, Math.pow(t, 6) * 0.9);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      i++;
    }
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.032, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  points = new THREE.Points(geo, mat);
  scene.add(points);

  clock = new THREE.Clock();
  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });
  window.addEventListener("resize", onResize);

  animate();
}

function onResize() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function animate() {
  raf = requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const pos = geo.attributes.position.array;

  for (let i = 0; i < pos.length; i += 3) {
    const x = base[i], y = base[i + 1];
    pos[i] = x + Math.sin(y * 0.9 + t * 0.6) * 0.22;
    pos[i + 1] = y + Math.cos(x * 0.7 + t * 0.5) * 0.18;
    pos[i + 2] = Math.sin(x * 0.55 + t * 0.55) * 0.75 + Math.cos(y * 0.8 - t * 0.35) * 0.5;
  }
  geo.attributes.position.needsUpdate = true;

  mouse.x += (mouse.tx - mouse.x) * 0.05;
  mouse.y += (mouse.ty - mouse.y) * 0.05;
  points.rotation.y = mouse.x * 0.12;
  points.rotation.x = mouse.y * 0.08;
  camera.position.x = mouse.x * 0.35;
  camera.position.y = -mouse.y * 0.25;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

document.addEventListener("visibilitychange", () => {
  if (!renderer) return;
  if (document.hidden) { cancelAnimationFrame(raf); }
  else { animate(); }
});

initThree();

/* ---------- gsap intro ---------- */
gsap.registerPlugin(ScrollTrigger);

function intro() {
  if (skipPreload) {
    gsap.set(".hero .eyebrow, .hero__title .line > span, .hero__title .line > em, .hero__copy, .hero__actions > *, .hero__meta > div, .hero__word", { clearProps: "all" });
    return;
  }
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.fromTo(".hero .eyebrow", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9 })
    .fromTo(".hero__title .line > span, .hero__title .line > em",
      { yPercent: 110 }, { yPercent: 0, duration: 1.15, stagger: 0.12 }, "-=0.6")
    .fromTo(".hero__copy", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9 }, "-=0.7")
    .fromTo(".hero__actions > *", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.1 }, "-=0.6")
    .fromTo(".hero__meta > div", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, stagger: 0.08 }, "-=0.5")
    .fromTo(".hero__word", { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 1.6 }, "-=1.4");
}

/* hero elements are staged by the intro timeline, so keep them visible */
document.querySelectorAll(".hero .reveal").forEach(el => el.classList.add("in"));
if (!skipPreload) setTimeout(intro, 1800);

/* ---------- scroll reveals ---------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (e.isIntersecting) {
      e.target.classList.add("in");
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

/* subtle parallax on gallery images */
document.querySelectorAll(".g-item").forEach((item) => {
  const img = item.querySelector("img");
  if (!img || reduce) return;
  gsap.fromTo(img, { yPercent: -4 }, {
    yPercent: 4, ease: "none",
    scrollTrigger: { trigger: item, start: "top bottom", end: "bottom top", scrub: true },
  });
});

/* ---------- nav ---------- */
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 40);
window.addEventListener("scroll", onScroll, { passive: true });
onScroll();

const burger = document.getElementById("burger");
const navLinks = document.getElementById("navLinks");
burger.addEventListener("click", () => {
  burger.classList.toggle("open");
  navLinks.classList.toggle("open");
});
navLinks.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    burger.classList.remove("open");
    navLinks.classList.remove("open");
  })
);

/* ---------- register modal ---------- */
const modal = document.getElementById("registerModal");
const form = document.getElementById("regForm");
const done = document.getElementById("regDone");

const openModal = () => {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("locked");
};
const closeModal = () => {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("locked");
};

document.querySelectorAll("[data-open-register]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    done.hidden = true;
    form.hidden = false;
    form.reset();
    openModal();
  });
});
modal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const name = (data.get("name") || "").toString().trim();
  const email = (data.get("email") || "").toString().trim();
  const phone = (data.get("phone") || "").toString().trim();
  if (!name || !email || !phone) {
    [form.name, form.email, form.phone].forEach((f) => {
      f.style.borderColor = !f.value.trim() ? "#b4553f" : "";
    });
    return;
  }
  form.hidden = true;
  done.hidden = false;
  document.getElementById("regName").textContent = ", " + name.split(" ")[0];
});

/* ---------- google sign-in placeholder ---------- */
document.getElementById("googleBtn").addEventListener("click", () => {
  const msg = document.getElementById("portalMsg");
  msg.textContent = "Google sign-in is connected at launch — this is the prototype.";
  msg.style.color = "var(--gold-soft)";
});

/* ---------- year ---------- */
document.getElementById("year").textContent = new Date().getFullYear();

/* ---------- screenshot helper (?shot=sectionId) ---------- */
const shotTarget = new URLSearchParams(location.search).get("shot");
if (shotTarget) {
  const el = document.getElementById(shotTarget);
  if (el) {
    document.querySelectorAll("main > section").forEach((s) => { if (s !== el) s.style.display = "none"; });
    const mq = document.querySelector(".marquee"); if (mq) mq.style.display = "none";
    setTimeout(() => el.scrollIntoView({ block: "start", behavior: "instant" }), 300);
  }
}
