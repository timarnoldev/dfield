// Built-in example gallery (.ode files).
export const EXAMPLES = [
  {
    name: 'FitzHugh–Nagumo',
    text: `# FitzHugh-Nagumo model of an excitable neuron
# Hopf bifurcations at I = 0.331 and I = 1.419
v'=v-v^3/3-w+I
w'=eps*(v+a-b*w)
par I=0.5, a=0.7, b=0.8, eps=0.08
init v=-1, w=1
@ total=200, dt=0.05, xp=v, yp=w, xlo=-2.5, xhi=2.5, ylo=-1, yhi=2.5
@ meth=rk4
@ parmin=0, parmax=2
done
`,
  },
  {
    name: 'Morris–Lecar',
    text: `# Morris-Lecar model (Rinzel & Ermentrout parameters, type II)
dv/dt=(i+gl*(vl-v)+gk*w*(vk-v)+gca*minf(v)*(vca-v))/c
dw/dt=lamw(v)*(winf(v)-w)
minf(v)=.5*(1+tanh((v-va)/vb))
winf(v)=.5*(1+tanh((v-vc)/vd))
lamw(v)=phi*cosh((v-vc)/(2*vd))
par i=100, phi=.04, vk=-84, vl=-60, vca=120
par gk=8, gl=2, c=20, gca=4.4
par va=-1.2, vb=18, vc=2, vd=30
init v=-60, w=0.01
aux ica=gca*minf(v)*(v-vca)
@ total=400, dt=0.25, xp=v, yp=w, xlo=-75, xhi=50, ylo=-0.1, yhi=0.6
@ meth=rk45, parmin=0, parmax=300
done
`,
  },
  {
    name: 'Hodgkin–Huxley',
    text: `# Hodgkin-Huxley squid axon model (rest near -65 mV)
# Hopf bifurcations at I = 9.78 and I = 154.5 uA/cm^2
dv/dt=(I - gna*m^3*h*(v-ena) - gk*n^4*(v-ek) - gl*(v-el))/c
dm/dt=am(v)*(1-m)-bm(v)*m
dh/dt=ah(v)*(1-h)-bh(v)*h
dn/dt=an(v)*(1-n)-bn(v)*n
am(v)=0.1*(v+40)/(1-exp(-(v+40)/10))
bm(v)=4*exp(-(v+65)/18)
ah(v)=0.07*exp(-(v+65)/20)
bh(v)=1/(1+exp(-(v+35)/10))
an(v)=0.01*(v+55)/(1-exp(-(v+55)/10))
bn(v)=0.125*exp(-(v+65)/80)
par I=10, c=1, gna=120, gk=36, gl=0.3
par ena=50, ek=-77, el=-54.4
init v=-65, m=0.05, h=0.6, n=0.32
aux ina=gna*m^3*h*(v-ena)
aux ik=gk*n^4*(v-ek)
@ total=100, dt=0.05, xp=t, yp=v, xlo=0, xhi=100, ylo=-80, yhi=50
@ meth=rk45, parmin=0, parmax=200
done
`,
  },
  {
    name: 'Lorenz',
    text: `# Lorenz equations (strange attractor)
x'=s*(y-x)
y'=x*(r-z)-y
z'=x*y-b*z
par r=28, s=10, b=8/3
init x=0.1, y=0, z=20
@ total=50, dt=0.01, meth=rk45
@ xp=x, yp=y, zp=z, axes=3
@ xlo=-25, xhi=25, ylo=-30, yhi=30
@ parmin=0, parmax=30
done
`,
  },
  {
    name: 'Van der Pol oscillator',
    text: `# Van der Pol oscillator: x'' - mu (1-x^2) x' + x = 0
x'=y
y'=mu*(1-x^2)*y-x
par mu=1
init x=0.5, y=0
@ total=60, dt=0.02, xp=x, yp=y, xlo=-4, xhi=4, ylo=-6, yhi=6
@ meth=rk45, parmin=-1, parmax=3
done
`,
  },
  {
    name: 'Lotka–Volterra',
    text: `# Lotka-Volterra predator-prey model
# x = prey, y = predator
x'=a*x-b*x*y
y'=-c*y+d*x*y
par a=1, b=0.5, c=0.75, d=0.25
init x=4, y=1
@ total=40, dt=0.02, xp=x, yp=y, xlo=0, xhi=10, ylo=0, yhi=6
@ meth=rk45
done
`,
  },
  {
    name: 'Brusselator',
    text: `# Brusselator: autocatalytic chemical oscillator
# Hopf bifurcation at b = 1 + a^2
x'=a-(b+1)*x+x^2*y
y'=b*x-x^2*y
par b=3, a=1
init x=1, y=1
@ total=50, dt=0.02, xp=x, yp=y, xlo=0, xhi=4.5, ylo=0, yhi=5
@ meth=rk45, parmin=0, parmax=4
done
`,
  },
  {
    name: 'Damped pendulum',
    text: `# Damped pendulum: theta'' + k theta' + (g/l) sin(theta) = 0
# saddles at theta = +-pi with separatrices
th'=om
om'=-g/l*sin(th)-k*om
par g=9.81, l=9.81, k=0.2
init th=1, om=0
@ total=40, dt=0.02, xp=th, yp=om, xlo=-7, xhi=7, ylo=-3.5, yhi=3.5
@ meth=rk45
done
`,
  },
  {
    name: 'Bistable toggle switch',
    text: `# Genetic toggle switch (Gardner, Cantor & Collins 2000)
# two stable states separated by a saddle; folds when a1 varies
u'=a1/(1+v^n)-u
v'=a2/(1+u^n)-v
par a1=3, a2=3, n=2
init u=0.5, v=2
@ total=20, dt=0.02, xp=u, yp=v, xlo=0, xhi=4, ylo=0, yhi=4
@ meth=rk45, parmin=0, parmax=6
done
`,
  },
  {
    name: 'Rössler',
    text: `# Rossler attractor
x'=-y-z
y'=x+a*y
z'=b+z*(x-c)
par c=5.7, a=0.2, b=0.2
init x=1, y=1, z=0
@ total=200, dt=0.02, meth=rk45, trans=50
@ xp=x, yp=y, zp=z, axes=3
@ xlo=-12, xhi=12, ylo=-12, yhi=12
@ parmin=2, parmax=7
done
`,
  },
  {
    name: 'Forced Duffing',
    text: `# Periodically forced Duffing oscillator (non-autonomous)
x'=y
y'=-d*y+x-x^3+g*cos(w*t)
par d=0.25, g=0.3, w=1
init x=1, y=0
@ total=300, dt=0.02, meth=rk45
@ xp=x, yp=y, xlo=-2, xhi=2, ylo=-1.5, yhi=1.5
done
`,
  },
];
