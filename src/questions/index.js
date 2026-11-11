import { CHAPTERS, SUBJECTS } from './catalog.js';
export { CHAPTERS, SUBJECTS };

export function createRng(seed) {
  let state = seed >>> 0;
  return { int(a, b) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return a + Math.floor((state / 4294967296) * (b - a + 1)); } };
}
const numerical = (stem, answer, solution) => ({ stem, answer: String(answer), solution });
const choices = (stem, values, answer, solution) => ({ stem, options: values.map((text, i) => ({ id: 'ABCD'[i], text: String(text) })), answer, solution });
const families = [];
function family(id, subject, chapter, title, type, build) { families.push({ id, subject, chapter, title, type, build }); }

family('phy-projectile-v1', 'physics', 'phy-kinematics', 'Projectile meets a height', 'numerical', r => {
  const a = r.int(2, 9), b = a + r.int(2, 6), u = 5 * (a + b), h = 5 * a * b;
  return numerical(`A ball is projected vertically upward with speed ${u} m/s. Taking g = 10 m/s² and neglecting air resistance, find the time interval (in s) between its two crossings of height ${h} m.`, b - a, [`At height h, h = ut − 5t². Hence 5t² − ${u}t + ${h} = 0.`, `The roots are t = ${a} s and t = ${b} s; their sum is ${a+b} and product is ${a*b}.`, `The interval is ${b} − ${a} = ${b-a} s.`]);
});
family('phy-atwood-v1', 'physics', 'phy-newton', 'Connected masses', 'numerical', r => {
  const m = r.int(2, 9), n = m + r.int(1, 6);
  return numerical(`Masses ${m} kg and ${n} kg hang on a massless string over an ideal pulley. The heavier mass moves downward. With g = 10 m/s², find the magnitude of acceleration in m/s². A fraction is accepted.`, `${10*(n-m)}/${n+m}`, [`For the heavy mass: ${n}g − T = ${n}a. For the light mass: T − ${m}g = ${m}a.`, `Adding eliminates tension: (${n} − ${m})g = (${n} + ${m})a.`, `a = ${10*(n-m)}/${n+m} m/s².`]);
});
family('phy-work-spring-v1', 'physics', 'phy-work', 'Energy after a spring launch', 'numerical', r => {
  const m = r.int(1, 5), v = r.int(2, 7), k = 100*m, x = v/10;
  return numerical(`A ${m} kg block is held against a spring of force constant ${k} N/m, compressed by ${x.toFixed(1)} m, on a smooth horizontal surface. It leaves the spring at its natural length. Find its speed in m/s.`, v, [`No work is lost to friction. The spring energy becomes kinetic energy.`, `½kx² = ½mv², so v = x√(k/m).`, `v = ${x.toFixed(1)} × √100 = ${v} m/s.`]);
});
family('phy-collision-v1', 'physics', 'phy-momentum', 'Perfectly inelastic collision', 'numerical', r => {
  const a=r.int(1,6), b=r.int(1,6), v=r.int(2,10), u=v*(a+b);
  return numerical(`A ${a} kg body travelling at ${u} m/s strikes a stationary ${b} kg body and sticks to it. External impulse is negligible. Find the speed of the combined body in m/s.`, a*v, [`Linear momentum is conserved, though kinetic energy need not be.`, `${a} × ${u} = (${a} + ${b})V.`, `V = ${a*v} m/s.`]);
});
family('phy-shm-v1', 'physics', 'phy-oscillations', 'Energy in SHM', 'single', r => {
  const k=r.int(1,8)*100, a=r.int(2,8)/10, e=k*a*a/2;
  return choices(`A particle attached to a spring (k = ${k} N/m) oscillates with amplitude ${a.toFixed(1)} m. At displacement A/2 from equilibrium, what fraction of its total mechanical energy is kinetic?`, ['1/4','1/2','3/4','√3/2'], 'C', [`The total energy is ½kA² = ${Number(e.toFixed(3))} J.`, 'At x = A/2, potential energy is ½k(A/2)² = E/4.', 'Kinetic energy is E − E/4 = 3E/4.']);
});
family('phy-capacitors-v1', 'physics', 'phy-electrostatics', 'Capacitors in series', 'numerical', r => {
  const c=r.int(1,9), v=r.int(2,9)*3;
  return numerical(`Capacitors ${c} μF and ${2*c} μF are connected in series across a ${v} V source. Find the charge magnitude on each capacitor in μC.`, `${2*c*v}/3`, [`In series both capacitors carry equal charge.`, `The equivalent capacitance is C₁C₂/(C₁+C₂) = ${2*c}/3 μF.`, `Q = C_eq V = ${2*c*v}/3 μC.`]);
});
family('phy-circuit-v1', 'physics', 'phy-circuits', 'Parallel resistors and heating', 'numerical', r => {
  const a=r.int(1,5), v=r.int(2,8)*a;
  return numerical(`Resistors ${2*a} Ω and ${3*a} Ω are connected in parallel to an ideal ${v} V battery. Find total electrical power dissipated in W. A fraction is accepted.`, `${5*v*v}/${6*a}`, [`The same voltage appears across both branches.`, `Total power = V²/R₁ + V²/R₂ = ${v}²(1/${2*a} + 1/${3*a}).`, `P = ${5*v*v}/${6*a} W.`]);
});
family('phy-lens-v1', 'physics', 'phy-optics', 'Convex lens image', 'numerical', r => {
  const f=r.int(2,8)*5, multiple=r.int(2,5), u=multiple*f;
  return numerical(`An object is placed ${u} cm in front of a thin convex lens of focal length ${f} cm. Find the distance of its real image from the lens, in cm. A fraction is accepted.`, `${u*f}/${u-f}`, [`Using the Cartesian sign convention, u = −${u} cm and f = +${f} cm.`, `1/v − 1/u = 1/f, so 1/v = 1/${f} − 1/${u}.`, `v = ${u*f}/${u-f} cm on the opposite side of the lens.`]);
});
family('phy-orbit-v1', 'physics', 'phy-gravitation', 'Circular-orbit relationships', 'multiple', r => {
  const k=r.int(2,20);
  return choices(`Two satellites of the same mass orbit the same planet in circular orbits of radii r and ${k*k}r. Neglect interactions between satellites. Select all true statements about the outer satellite relative to the inner one.`, [`Its orbital speed is 1/${k} as large.`, `Its period is ${k*k*k} times as large.`, `Its kinetic energy is ${k*k} times as large.`, `The magnitude of its total energy is 1/${k*k} as large.`], ['A','B','D'], ['For a circular orbit v = √(GM/r), so speed scales as r^(−1/2).', 'T = 2πr/v scales as r^(3/2). K = GMm/(2r) and |E| = GMm/(2r) both scale as 1/r.', `The ratios are v₂/v₁ = 1/${k}, T₂/T₁ = ${k*k*k}, K₂/K₁ = |E₂|/|E₁| = 1/${k*k}.`]);
});
family('phy-photoelectric-v1', 'physics', 'phy-modern', 'Photoelectric stopping potential', 'numerical', r => {
  const work=r.int(2,5), first=r.int(1,4), second=first+r.int(1,4);
  return numerical(`A metal has work function ${work} eV. Incident photons first have energy ${work+first} eV, then ${work+second} eV. What is the increase in stopping potential, in volts?`, second-first, [`Einstein’s equation gives K_max = E_photon − φ.`, `The maximum kinetic energies are ${first} eV and ${second} eV, giving stopping potentials ${first} V and ${second} V.`, `The increase is ${second-first} V.`]);
});

family('chem-limiting-v1', 'chemistry', 'chem-mole', 'Limiting reagent and yield', 'numerical', r => {
  const n=r.int(2,8), h=3*n-r.int(1,3);
  return numerical(`In N₂ + 3H₂ → 2NH₃, ${n} mol N₂ is mixed with ${h} mol H₂. The reaction reaches its stoichiometric limit and the isolated yield is 75% of the theoretical ammonia. Find the moles of NH₃ isolated.`, `${h}/2`, [`Complete use of ${n} mol N₂ would require ${3*n} mol H₂; only ${h} mol is present, so H₂ is limiting.`, `The theoretical yield of NH₃ is 2 × ${h}/3 mol.`, `The isolated yield is (3/4) × (2${h}/3) = ${h}/2 mol.`]);
});
family('chem-hydrogen-v1', 'chemistry', 'chem-atomic', 'Hydrogen excitation', 'numerical', r => {
  const n=r.int(2,5);
  return numerical(`The energy levels of a hydrogen atom are Eₙ = −13.6/n² eV. Find the excitation energy in eV needed to take the atom from n = 1 to n = ${n}. A fraction is accepted.`, `${136*(n*n-1)}/${10*n*n}`, [`Excitation energy is E_final − E_initial.`, `ΔE = −13.6/${n*n} − (−13.6) = 13.6(1 − 1/${n*n}).`, `ΔE = ${136*(n*n-1)}/${10*n*n} eV.`]);
});
family('chem-gas-v1', 'chemistry', 'chem-gases', 'Two ideal-gas states', 'numerical', r => {
  const p=r.int(1,4), k=r.int(2,5), t=r.int(2,4)*100;
  return numerical(`A fixed amount of ideal gas initially occupies V at ${p} bar and ${t} K. It is taken to volume V/${k} and temperature ${2*t} K. Find its final pressure in bar.`, 2*p*k, [`For a fixed amount, PV/T is constant.`, `P₂/P₁ = (T₂/T₁)(V₁/V₂) = 2 × ${k}.`, `P₂ = ${p} × ${2*k} = ${2*p*k} bar.`]);
});
family('chem-hess-v1', 'chemistry', 'chem-thermo', 'Hess law', 'numerical', r => {
  const first=-(r.int(2,7)*10), second=-(r.int(2,7)*10);
  return numerical(`For A → B, ΔH = ${first} kJ mol⁻¹; for B → C, ΔH = ${second} kJ mol⁻¹. Find ΔH in kJ mol⁻¹ for 2C → 2A, using these formal stoichiometric equations.`, -2*(first+second), [`Adding the first two equations gives A → C with ΔH = ${first+second} kJ mol⁻¹.`, 'Reversing a reaction changes the sign of ΔH; doubling the equation doubles ΔH.', `For 2C → 2A, ΔH = −2(${first+second}) = ${-2*(first+second)} kJ mol⁻¹.`]);
});
family('chem-kc-v1', 'chemistry', 'chem-equilibrium', 'Equilibrium from a dissociation', 'numerical', r => {
  const initial=r.int(3,9), extent=r.int(1,initial-1);
  return numerical(`For A(g) ⇌ 2B(g), a 1 L vessel initially contains ${initial} mol A and no B. At equilibrium, ${extent} mol A has dissociated. Calculate the numerical value of Kc when concentrations are expressed in mol L⁻¹.`, `${4*extent*extent}/${initial-extent}`, [`At equilibrium [A] = ${initial-extent} mol L⁻¹ and [B] = ${2*extent} mol L⁻¹.`, 'Kc = [B]²/[A].', `The numerical value is ${4*extent*extent}/${initial-extent}.`]);
});
family('chem-neutralisation-v1', 'chemistry', 'chem-ionic', 'Acid–base mixing', 'single', r => {
  const volume=r.int(1,6)*10;
  return choices(`Equal volumes of ${volume} mL each of 0.20 mol L⁻¹ HCl and 0.10 mol L⁻¹ NaOH are mixed at 25°C. Assume complete dissociation and additive volumes. Which expression gives the final pH?`, ['−log₁₀(0.05)','−log₁₀(0.10)','7','14 + log₁₀(0.05)'], 'A', [`H⁺ remaining = (0.20 − 0.10) × ${volume/1000} = ${Number((volume/10000).toFixed(4))} mol.`, `Total volume is ${2*volume/1000} L, so [H⁺] = 0.05 mol L⁻¹.`, 'pH = −log₁₀(0.05), approximately 1.301.']);
});
family('chem-electrolysis-v1', 'chemistry', 'chem-electrochemistry', 'Faraday stoichiometry', 'numerical', r => {
  const n=r.int(1,6), atomic=64;
  return numerical(`A charge of ${n} F is passed through aqueous CuSO₄ with sufficient Cu²⁺ available, where 1 F is one mole of electron charge. Assume 100% current efficiency for Cu²⁺ + 2e⁻ → Cu. Using M(Cu) = ${atomic} g mol⁻¹, find the mass of copper deposited in grams.`, 32*n, [`Each mole of Cu requires 2 mol electrons.`, `${n} F supplies ${n} mol electrons and deposits ${n}/2 mol Cu.`, `Mass = (${n}/2) × 64 = ${32*n} g.`]);
});
family('chem-first-order-v1', 'chemistry', 'chem-kinetics', 'Successive half-lives', 'numerical', r => {
  const half=r.int(2,12)*5, count=r.int(2,5);
  return numerical(`A first-order reaction has half-life ${half} min. How many minutes are required for the reactant concentration to fall to 1/${2**count} of its initial value?`, half*count, [`After n half-lives, [A]/[A]₀ = (1/2)ⁿ.`, `1/${2**count} = (1/2)^${count}, so ${count} half-lives are required.`, `Time = ${count} × ${half} = ${half*count} min.`]);
});
family('chem-colligative-v1', 'chemistry', 'chem-solutions', 'Freezing-point depression', 'numerical', r => {
  const mass=r.int(1,6)*10, solventUnits=r.int(1,4), solvent=solventUnits/10;
  return numerical(`${mass} g of a non-volatile, non-electrolyte solute of molar mass 100 g mol⁻¹ is dissolved in ${solventUnits*100} g of solvent. Its cryoscopic constant is 2 K kg mol⁻¹. Assuming an ideal dilute solution, find the freezing-point depression in K.`, `${2*mass}/${10*solventUnits}`, [`Moles of solute = ${mass}/100. Mass of solvent = ${solvent.toFixed(1)} kg.`, `Molality m = (${mass}/100)/${solvent.toFixed(1)}.`, `ΔT_f = K_f m = ${2*mass}/${10*solventUnits} K.`]);
});
family('chem-isomers-v1', 'chemistry', 'chem-organic', 'Acyclic alkane relationships', 'multiple', r => {
  const n=r.int(4,24);
  return choices(`For an acyclic saturated hydrocarbon with ${n} carbon atoms, select every necessarily true statement.`, [`Its molecular formula is C${n}H${2*n+2}.`, `Complete combustion of one mole consumes ${(3*n+1)}/2 mol O₂.`, `Every carbon atom must be bonded to two other carbon atoms.`, `Complete combustion of one mole produces ${n} mol CO₂.`], ['A','B','D'], ['An acyclic saturated hydrocarbon is an alkane with formula CₙH₂ₙ₊₂.', `C${n}H${2*n+2} + (${3*n+1}/2)O₂ → ${n}CO₂ + ${n+1}H₂O.`, 'Branching and terminal carbon atoms disprove the assertion that every carbon has two carbon neighbours.']);
});

family('math-roots-v1', 'mathematics', 'math-quadratic', 'Cubic sum of roots', 'numerical', r => {
  const a=r.int(1,8), b=r.int(2,9), s=a+b, p=a*b;
  return numerical(`If α and β are the roots of x² − ${s}x + ${p} = 0, find α³ + β³.`, a**3+b**3, [`By Vieta, α + β = ${s} and αβ = ${p}.`, `α³ + β³ = (α+β)³ − 3αβ(α+β).`, `The value is ${s}³ − 3 × ${p} × ${s} = ${a**3+b**3}.`]);
});
family('math-complex-v1', 'mathematics', 'math-complex', 'Modulus after multiplication', 'numerical', r => {
  const a=r.int(1,8), b=r.int(1,8);
  return numerical(`For z = (${a} + ${b}i)(1 − i), find |z|².`, 2*(a*a+b*b), [`The squared modulus of a product is the product of squared moduli.`, `|${a}+${b}i|² = ${a*a+b*b}, while |1−i|² = 2.`, `Thus |z|² = ${2*(a*a+b*b)}.`]);
});
family('math-ap-v1', 'mathematics', 'math-sequences', 'Recover an arithmetic progression', 'numerical', r => {
  const a=r.int(1,10), d=r.int(2,7), n=r.int(8,16), t3=a+2*d, t7=a+6*d;
  return numerical(`The third and seventh terms of an arithmetic progression are ${t3} and ${t7}. Find the sum of its first ${n} terms.`, n*(2*a+(n-1)*d)/2, [`Subtracting terms gives 4d = ${t7-t3}, so d = ${d}.`, `The first term is a = ${t3} − 2(${d}) = ${a}.`, `S_${n} = (${n}/2)[2(${a}) + ${n-1}(${d})] = ${n*(2*a+(n-1)*d)/2}.`]);
});
family('math-binomial-v1', 'mathematics', 'math-binomial', 'A specified binomial coefficient', 'numerical', r => {
  const n=r.int(4,9), a=r.int(2,5);
  return numerical(`Find the coefficient of x² in (1 + ${a}x)^${n}.`, n*(n-1)*a*a/2, [`The x² term is obtained by choosing ${a}x from exactly two of the ${n} factors.`, `Its coefficient is C(${n},2) × ${a}².`, `This equals ${n*(n-1)*a*a/2}.`]);
});
family('math-probability-v1', 'mathematics', 'math-probability', 'Draws without replacement', 'numerical', r => {
  const red=r.int(2,8), blue=r.int(2,8), total=red+blue;
  return numerical(`A bag contains ${red} red and ${blue} blue balls. Two balls are drawn uniformly without replacement. Find the probability that exactly one is red. Give an exact decimal or fraction.`, `${2*red*blue}/${total*(total-1)}`, [`There are C(${total},2) unordered pairs in total.`, `A favourable pair chooses one of ${red} red and one of ${blue} blue balls: ${red*blue} pairs.`, `Probability = ${red*blue}/C(${total},2) = ${2*red*blue}/${total*(total-1)}.`]);
});
family('math-matrix-v1', 'mathematics', 'math-matrices', 'Determinant of a square', 'numerical', r => {
  const a=r.int(1,6), b=r.int(1,5), c=r.int(1,5), d=r.int(2,7), determinant=a*d-b*c;
  return numerical(`Let A be the 2 × 2 matrix with first row (${a}, ${b}) and second row (${c}, ${d}). Find det(A²).`, determinant**2, [`det(A) = ad − bc = ${a}×${d} − ${b}×${c} = ${determinant}.`, 'The determinant is multiplicative: det(A²) = det(A)det(A).', `Therefore det(A²) = ${determinant**2}.`]);
});
family('math-conic-v1', 'mathematics', 'math-conics', 'Normal to a parabola', 'single', r => {
  const a=r.int(1,12), t=r.int(2,9);
  return choices(`For the parabola y² = ${4*a}x, consider the point (${a*t*t}, ${2*a*t}). What is the slope of the normal at this point?`, [`−${t}`, `1/${t}`, `${t}`, `−1/${t}`], 'A', [`Implicit differentiation gives 2y(dy/dx) = ${4*a}.`, `At the specified point, the tangent slope is (2a)/y = 1/${t}.`, `The normal is perpendicular to the tangent, so its slope is −${t}.`]);
});
family('math-optimisation-v1', 'mathematics', 'math-derivatives', 'Stationary-point classification', 'multiple', r => {
  const a=r.int(1,6);
  return choices(`Let f(x) = x³ − ${3*a*a}x for real x. Select every true statement.`, [`f has a local maximum at x = −${a}.`, `f has a local minimum at x = ${a}.`, `f is decreasing for all real x.`, `f(${a}) = ${-2*a**3}.`], ['A','B','D'], [`f′(x) = 3x² − ${3*a*a} = 3(x−${a})(x+${a}), giving stationary points ±${a}.`, `f″(x) = 6x is negative at −${a} and positive at ${a}.`, `f decreases only on (−${a}, ${a}); direct substitution gives f(${a}) = ${-2*a**3}.`]);
});
family('math-integral-v1', 'mathematics', 'math-integrals', 'An integral by symmetry', 'numerical', r => {
  const a=r.int(1,6), b=r.int(1,6);
  return numerical(`Evaluate the integral from −${a} to ${a} of (x³ + ${b}x² + 1) dx. Give an exact decimal or fraction.`, `${2*b*a**3+6*a}/3`, ['The odd term x³ integrates to zero on symmetric limits.', `The remaining integral is 2 ∫₀^${a} (${b}x² + 1) dx = 2[${b}x³/3 + x]₀^${a}.`, `The value is ${2*b*a**3+6*a}/3.`]);
});
family('math-vectors-v1', 'mathematics', 'math-vectors', 'Perpendicular vectors', 'numerical', r => {
  const a=r.int(1,8), b=r.int(1,8), c=r.int(1,8);
  return numerical(`Vectors a = (${a}, ${b}, 1) and b = (2, −${c}, λ) are perpendicular. Find λ.`, b*c-2*a, [`Perpendicular vectors have zero scalar product.`, `${a}×2 + ${b}×(−${c}) + λ = 0.`, `λ = ${b*c} − ${2*a} = ${b*c-2*a}.`]);
});

const registry = new Map(families.map(f => [f.id, f]));
export function listTemplates({ subject = 'all', chapter = 'all', type = 'all' } = {}) {
  return families.filter(f => (subject === 'all' || f.subject === subject) && (chapter === 'all' || f.chapter === chapter) && (type === 'all' || f.type === type)).map(({ build, ...metadata }) => ({ ...metadata }));
}
export function generate(templateId, seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a 32-bit unsigned integer');
  const f = registry.get(templateId);
  if (!f) throw new Error('Unknown question family');
  const { build, ...metadata } = f;
  const question = build(createRng(seed));
  if (question.options) {
    const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
    const oldOptions = [...question.options];
    for (let i = oldOptions.length - 1; i > 0; i--) { const j = rng.int(0, i); [oldOptions[i], oldOptions[j]] = [oldOptions[j], oldOptions[i]]; }
    const ids = new Map(oldOptions.map((o, i) => [o.id, 'ABCD'[i]]));
    question.options = oldOptions.map((o, i) => ({ id: 'ABCD'[i], text: o.text }));
    question.answer = Array.isArray(question.answer) ? question.answer.map(a => ids.get(a)).sort() : ids.get(question.answer);
  }
  return { ...metadata, ...question, id: `${templateId}:${seed}`, templateId, seed, origin: 'original', difficulty: 'practice', marking: f.type === 'single' ? { correct: 3, incorrect: -1, unanswered: 0 } : f.type === 'multiple' ? { correct: 4, incorrect: -2, unanswered: 0, partial: { perCorrect: 1 } } : { correct: 4, incorrect: 0, unanswered: 0 } };
}
